"use strict";
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');

const helper = new Helper();

class NetworkMonitor {
  constructor(rootDocShell, frameTree) {
    this._frameTree = frameTree;
    this.QueryInterface = ChromeUtils.generateQI([
      Ci.nsIWebProgressListener,
      Ci.nsIWebProgressListener2,
      Ci.nsISupportsWeakReference,
    ]);
    this._requestDetails = new Map();

    const webProgress = rootDocShell.QueryInterface(Ci.nsIInterfaceRequestor)
                                .getInterface(Ci.nsIWebProgress);
    const flags = Ci.nsIWebProgress.NOTIFY_STATE_REQUEST;
    this._eventListeners = [
      helper.addProgressListener(webProgress, this, flags),
    ];
  }

  onStateChange(progress, request, flag, status) {
    if (!(request instanceof Ci.nsIHttpChannel))
      return;
    let loadContext = null;
    if (request.notificationCallbacks)
      loadContext = request.notificationCallbacks.getInterface(Ci.nsILoadContext);
    else if (request.loadGroup)
      loadContext = request.loadGroup.notificationCallbacks.getInterface(Ci.nsILoadContext);
    if (!loadContext)
      return;
    const window = loadContext.associatedWindow;
    const frame = this._frameTree.frameForDocShell(window.docShell)
    if (!frame)
      return;
    this._requestDetails.set(request.channelId, {
      frameId: frame.id(),
    });
  }

  requestDetails(channelId) {
    return this._requestDetails.get(channelId) || null;
  }

  dispose() {
    this._requestDetails.clear();
    helper.removeListeners(this._eventListeners);
  }
}

var EXPORTED_SYMBOLS = ['NetworkMonitor'];
this.NetworkMonitor = NetworkMonitor;

