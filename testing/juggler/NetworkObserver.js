"use strict";

const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');
const {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");

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
  constructor() {
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
    const delegate = loadContext ? this._browsers.get(loadContext.topFrameElement) : null;
    if (!delegate)
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
    const delegate = loadContext ? this._browsers.get(loadContext.topFrameElement) : null;
    if (!delegate)
      return;
    if (activitySubtype === Ci.nsIHttpActivityObserver.ACTIVITY_SUBTYPE_REQUEST_HEADER) {
      const causeType = httpChannel.loadInfo ? httpChannel.loadInfo.externalContentPolicyType : Ci.nsIContentPolicy.TYPE_OTHER;
      const oldChannel = this._redirectMap.get(httpChannel);
      this._redirectMap.delete(httpChannel);
      const headers = [];
      httpChannel.visitRequestHeaders({
        visitHeader: (name, value) => headers.push({name, value}),
      });
      delegate.onRequestWillBeSent(httpChannel, {
        url: httpChannel.URI.spec,
        headers,
        method: httpChannel.requestMethod,
        isNavigationRequest: httpChannel.isMainDocumentChannel,
        cause: causeTypeToString(causeType),
      }, oldChannel);
    } else if (activitySubtype === Ci.nsIHttpActivityObserver.ACTIVITY_SUBTYPE_TRANSACTION_CLOSE) {
      delegate.onRequestFinished(httpChannel, {});
    }
  }

  _onResponse(fromCache, httpChannel, topic) {
    const loadContext = getLoadContext(httpChannel);
    const delegate = loadContext ? this._browsers.get(loadContext.topFrameElement) : null;
    if (!delegate)
      return;
    httpChannel.QueryInterface(Ci.nsIHttpChannelInternal);
    const headers = [];
    httpChannel.visitResponseHeaders({
      visitHeader: (name, value) => headers.push({name, value}),
    });
    delegate.onResponseReceived(httpChannel, {
      fromCache,
      headers,
      remoteIPAddress: httpChannel.remoteAddress,
      remotePort: httpChannel.remotePort,
      status: httpChannel.responseStatus,
      statusText: httpChannel.responseStatusText,
    });
  }

  trackBrowserNetwork(browser, delegate) {
    this._browsers.set(browser, delegate);
  }

  dispose() {
    this._activityDistributor.removeObserver(this);
    const registrar = Cm.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.unregisterFactory(SINK_CLASS_ID, this._channelSinkFactory);
    Services.catMan.deleteCategoryEntry(SINK_CATEGORY_NAME, SINK_CONTRACT_ID, false);
    helper.removeListeners(this._eventListeners);
  }
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
