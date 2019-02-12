"use strict";

const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const helper = new Helper();

class NetworkObserver {
  constructor() {
    this._browsers = new Map();
    const activityDistributor = Cc["@mozilla.org/network/http-activity-distributor;1"].getService(Ci.nsIHttpActivityDistributor);
    activityDistributor.addObserver(this);
  }

  observeActivity(channel, activityType, activitySubtype, timestamp, extraSizeData, extraStringData) {
    if (activityType !== Ci.nsIHttpActivityObserver.ACTIVITY_TYPE_HTTP_TRANSACTION)
      return;
    if (!(channel instanceof Ci.nsIHttpChannel))
      return;
    const httpChannel = channel.QueryInterface(Ci.nsIHttpChannel);
    let loadContext = null;
    try {
      if (httpChannel.notificationCallbacks)
        loadContext = httpChannel.notificationCallbacks.getInterface(Ci.nsILoadContext);
    } catch (e) {}
    try {
      if (!loadContext && httpChannel.loadGroup)
        loadContext = httpChannel.loadGroup.notificationCallbacks.getInterface(Ci.nsILoadContext);
    } catch (e) { }
    let delegate = loadContext ? this._browsers.get(loadContext.topFrameElement) : null;
    if (!delegate)
      return;
    if (activitySubtype === Ci.nsIHttpActivityObserver.ACTIVITY_SUBTYPE_REQUEST_HEADER)
      delegate.onRequestWillBeSent(httpChannel);
  }

  trackBrowserNetwork(browser, delegate) {
    this._browsers.set(browser, delegate);
  }
}

var EXPORTED_SYMBOLS = ['NetworkObserver'];
this.NetworkObserver = NetworkObserver;
