"use strict";

const {EventEmitter} = ChromeUtils.import('resource://gre/modules/EventEmitter.jsm');
const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');
const {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");
const {NetUtil} = ChromeUtils.import('resource://gre/modules/NetUtil.jsm');

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cm = Components.manager;
const helper = new Helper();

/**
 * This is a nsIChannelEventSink implementation that monitors channel redirects.
 */
const SINK_CLASS_DESCRIPTION = "Juggler NetworkMonitor Channel Event Sink";
const SINK_CLASS_ID = Components.ID("{c2b4c83e-607a-405a-beab-0ef5dbfb7617}");
const SINK_CONTRACT_ID = "@mozilla.org/network/monitor/channeleventsink;1";
const SINK_CATEGORY_NAME = "net-channel-event-sinks";

class NetworkObserver {
  static instance() {
    return NetworkObserver._instance || null;
  }

  static initialize() {
    if (NetworkObserver._instance)
      return;
    NetworkObserver._instance = new NetworkObserver();
  }
  
  constructor() {
    EventEmitter.decorate(this);
    this._browsers = new Map();
    this._activityDistributor = Cc["@mozilla.org/network/http-activity-distributor;1"].getService(Ci.nsIHttpActivityDistributor);
    this._activityDistributor.addObserver(this);

    this._redirectMap = new Map();
    this._channelSink = {
      QueryInterface: ChromeUtils.generateQI([Ci.nsIChannelEventSink]),
      asyncOnChannelRedirect: (oldChannel, newChannel, flags, callback) => {
        this._onRedirect(oldChannel, newChannel);
        callback.onRedirectVerifyCallback(Cr.NS_OK);
      },
    };
    this._channelSinkFactory = {
      QueryInterface: ChromeUtils.generateQI([Ci.nsIFactory]),
      createInstance: (aOuter, aIID) => this._channelSink.QueryInterface(aIID),
    };
    // Register self as ChannelEventSink to track redirects.
    const registrar = Cm.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(SINK_CLASS_ID, SINK_CLASS_DESCRIPTION, SINK_CONTRACT_ID, this._channelSinkFactory);
    Services.catMan.addCategoryEntry(SINK_CATEGORY_NAME, SINK_CONTRACT_ID, SINK_CONTRACT_ID, false, true);

    this._eventListeners = [
      helper.addObserver(this._onResponse.bind(this, false /* fromCache */), 'http-on-examine-response'),
      helper.addObserver(this._onResponse.bind(this, true /* fromCache */), 'http-on-examine-cached-response'),
      helper.addObserver(this._onResponse.bind(this, true /* fromCache */), 'http-on-examine-merged-response'),
    ];
  }

  _onRedirect(oldChannel, newChannel) {
    if (!(oldChannel instanceof Ci.nsIHttpChannel))
      return;
    const httpChannel = oldChannel.QueryInterface(Ci.nsIHttpChannel);
    const loadContext = getLoadContext(httpChannel);
    if (!loadContext || !this._browsers.has(loadContext.topFrameElement))
      return;
    this._redirectMap.set(newChannel, oldChannel);
  }

  observeActivity(channel, activityType, activitySubtype, timestamp, extraSizeData, extraStringData) {
    if (activityType !== Ci.nsIHttpActivityObserver.ACTIVITY_TYPE_HTTP_TRANSACTION)
      return;
    if (!(channel instanceof Ci.nsIHttpChannel))
      return;
    const httpChannel = channel.QueryInterface(Ci.nsIHttpChannel);
    const loadContext = getLoadContext(httpChannel);
    if (!loadContext || !this._browsers.has(loadContext.topFrameElement))
      return;
    if (activitySubtype === Ci.nsIHttpActivityObserver.ACTIVITY_SUBTYPE_REQUEST_HEADER) {
      const causeType = httpChannel.loadInfo ? httpChannel.loadInfo.externalContentPolicyType : Ci.nsIContentPolicy.TYPE_OTHER;
      const oldChannel = this._redirectMap.get(httpChannel);
      this._redirectMap.delete(httpChannel);
      const headers = [];
      httpChannel.visitRequestHeaders({
        visitHeader: (name, value) => headers.push({name, value}),
      });
      this.emit('request', httpChannel, {
        url: httpChannel.URI.spec,
        postData: readPostData(httpChannel),
        headers,
        method: httpChannel.requestMethod,
        isNavigationRequest: httpChannel.isMainDocumentChannel,
        cause: causeTypeToString(causeType),
      }, oldChannel);
    } else if (activitySubtype === Ci.nsIHttpActivityObserver.ACTIVITY_SUBTYPE_TRANSACTION_CLOSE) {
      this.emit('requestfinished', httpChannel, {});
    }
  }

  _onResponse(fromCache, httpChannel, topic) {
    const loadContext = getLoadContext(httpChannel);
    if (!loadContext || !this._browsers.has(loadContext.topFrameElement))
      return;
    httpChannel.QueryInterface(Ci.nsIHttpChannelInternal);
    const headers = [];
    httpChannel.visitResponseHeaders({
      visitHeader: (name, value) => headers.push({name, value}),
    });
    this.emit('response', httpChannel, {
      securityDetails: getSecurityDetails(httpChannel),
      fromCache,
      headers,
      remoteIPAddress: httpChannel.remoteAddress,
      remotePort: httpChannel.remotePort,
      status: httpChannel.responseStatus,
      statusText: httpChannel.responseStatusText,
    });
  }

  startTrackingBrowserNetwork(browser) {
    const value = this._browsers.get(browser) || 0;
    this._browsers.set(browser, value + 1);
    return () => this.stopTrackingBrowserNetwork(browser);
  }

  stopTrackingBrowserNetwork(browser) {
    const value = this._browsers.get(browser);
    if (value)
      this._browsers.set(browser, value - 1);
    else
      this._browsers.delete(browser);
  }

  dispose() {
    this._activityDistributor.removeObserver(this);
    const registrar = Cm.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.unregisterFactory(SINK_CLASS_ID, this._channelSinkFactory);
    Services.catMan.deleteCategoryEntry(SINK_CATEGORY_NAME, SINK_CONTRACT_ID, false);
    helper.removeListeners(this._eventListeners);
  }
}

const protocolVersionNames = {
  [Ci.nsITransportSecurityInfo.TLS_VERSION_1]: 'TLS 1',
  [Ci.nsITransportSecurityInfo.TLS_VERSION_1_1]: 'TLS 1.1',
  [Ci.nsITransportSecurityInfo.TLS_VERSION_1_2]: 'TLS 1.2',
  [Ci.nsITransportSecurityInfo.TLS_VERSION_1_3]: 'TLS 1.3',
};

function getSecurityDetails(httpChannel) {
  const securityInfo = httpChannel.securityInfo;
  if (!securityInfo)
    return null;
  securityInfo.QueryInterface(Ci.nsITransportSecurityInfo);
  if (!securityInfo.serverCert)
    return null;
  return {
    protocol: protocolVersionNames[securityInfo.protocolVersion] || '<unknown>',
    subjectName: securityInfo.serverCert.commonName,
    issuer: securityInfo.serverCert.issuerCommonName,
    // Convert to seconds.
    validFrom: securityInfo.serverCert.validity.notBefore / 1000 / 1000,
    validTo: securityInfo.serverCert.validity.notAfter / 1000 / 1000,
  };
}

function readPostData(httpChannel) {
  if (!(httpChannel instanceof Ci.nsIUploadChannel))
    return undefined;
  const iStream = httpChannel.uploadStream;
  if (!iStream)
    return undefined;
  const isSeekableStream = iStream instanceof Ci.nsISeekableStream;

  let prevOffset;
  if (isSeekableStream) {
    prevOffset = iStream.tell();
    iStream.seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);
  }

  // Read data from the stream.
  let text = undefined;
  try {
    text = NetUtil.readInputStreamToString(iStream, iStream.available());
    const converter = Cc['@mozilla.org/intl/scriptableunicodeconverter']
        .createInstance(Ci.nsIScriptableUnicodeConverter);
    converter.charset = 'UTF-8';
    text = converter.ConvertToUnicode(text);
  } catch (err) {
    text = undefined;
  }

  // Seek locks the file, so seek to the beginning only if necko hasn't
  // read it yet, since necko doesn't seek to 0 before reading (at lest
  // not till 459384 is fixed).
  if (isSeekableStream && prevOffset == 0)
    iStream.seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);
  return text;
}

function getLoadContext(httpChannel) {
  let loadContext = null;
  try {
    if (httpChannel.notificationCallbacks)
      loadContext = httpChannel.notificationCallbacks.getInterface(Ci.nsILoadContext);
  } catch (e) {}
  try {
    if (!loadContext && httpChannel.loadGroup)
      loadContext = httpChannel.loadGroup.notificationCallbacks.getInterface(Ci.nsILoadContext);
  } catch (e) { }
  return loadContext;
}

function causeTypeToString(causeType) {
  for (let key in Ci.nsIContentPolicy) {
    if (Ci.nsIContentPolicy[key] === causeType)
      return key;
  }
  return 'TYPE_OTHER';
}

var EXPORTED_SYMBOLS = ['NetworkObserver'];
this.NetworkObserver = NetworkObserver;
