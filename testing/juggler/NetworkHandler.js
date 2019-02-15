"use strict";

const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
const FRAME_SCRIPT = "chrome://juggler/content/content/ContentSession.js";
const helper = new Helper();

class NetworkHandler {
  constructor(chromeSession, contentSession, target) {
    this._pageId = target.id();
    this._chromeSession = chromeSession;
    this._contentSession = contentSession;
    this._networkObserver = chromeSession.networkObserver();
    this._httpActivity = new Map();
    this._eventListeners = [
      helper.on(this._networkObserver, 'request', this._onRequest.bind(this)),
      helper.on(this._networkObserver, 'response', this._onResponse.bind(this)),
      helper.on(this._networkObserver, 'requestfinished', this._onRequestFinished.bind(this)),
      this._networkObserver.startTrackingBrowserNetwork(target.tab().linkedBrowser),
    ];
  }

  dispose() {
    helper.removeListeners(this._eventListeners);
  }

  _ensureHTTPActivity(requestId) {
    let activity = this._httpActivity.get(requestId);
    if (!activity) {
      activity = {
        _id: requestId,
        _lastSentEvent: null,
        request: null,
        response: null,
        complete: null,
      };
      this._httpActivity.set(requestId, activity);
    }
    return activity;
  }

  _reportHTTPAcitivityEvents(activity) {
    // State machine - sending network events.
    if (!activity._lastSentEvent && activity.request) {
      this._chromeSession.emitEvent('Network.requestWillBeSent', activity.request);
      activity._lastSentEvent = 'requestWillBeSent';
    }
    if (activity._lastSentEvent === 'requestWillBeSent' && activity.response) {
      this._chromeSession.emitEvent('Network.responseReceived', activity.response);
      activity._lastSentEvent = 'responseReceived';
    }
    if (activity._lastSentEvent === 'responseReceived' && activity.complete) {
      this._chromeSession.emitEvent('Network.requestFinished', activity.complete);
      activity._lastSentEvent = 'requestFinished';
    }

    // Clean up if request lifecycle is over.
    if (activity._lastSentEvent === 'requestFinished')
      this._httpActivity.delete(activity._id);
  }

  async _onRequest(httpChannel, eventDetails, redirectedFromChannel) {
    const details = await this._contentSession.send('requestDetails', {channelId: httpChannel.channelId});
    const activity = this._ensureHTTPActivity(httpChannel.channelId);
    activity.request = {
      requestId: httpChannel.channelId + '',
      redirectedFrom: redirectedFromChannel ? redirectedFromChannel.channelId + '' : undefined,
      pageId: this._pageId,
      frameId: details ? details.frameId : undefined,
      ...eventDetails,
    };
    this._reportHTTPAcitivityEvents(activity);
  }

  async _onResponse(httpChannel, eventDetails) {
    const activity = this._ensureHTTPActivity(httpChannel.channelId);
    activity.response = {
      requestId: httpChannel.channelId + '',
      pageId: this._pageId,
      ...eventDetails,
    };
    this._reportHTTPAcitivityEvents(activity);
  }

  async _onRequestFinished(httpChannel, eventDetails) {
    const details = await this._contentSession.send('requestDetails', {channelId: httpChannel.channelId});
    const activity = this._ensureHTTPActivity(httpChannel.channelId);
    activity.complete = {
      ...eventDetails,
      requestId: httpChannel.channelId + '',
      pageId: this._pageId,
      errorCode: details ? details.errorCode : undefined,
    };
    this._reportHTTPAcitivityEvents(activity);
  }

}

var EXPORTED_SYMBOLS = ['NetworkHandler'];
this.NetworkHandler = NetworkHandler;
