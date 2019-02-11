"use strict";

const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
const FRAME_SCRIPT = "chrome://juggler/content/content/ContentSession.js";
const helper = new Helper();

class NetworkObserver {
  constructor() {
    const activityDistributor = Cc["@mozilla.org/network/http-activity-distributor;1"].getService(Ci.nsIHttpActivityDistributor);
    activityDistributor.addObserver(this);
  }

  observeActivity(channel, activityType, activitySubtype, timestamp, extraSizeData, extraStringData) {
    if (activityType !== Ci.nsIHttpActivityObserver.ACTIVITY_TYPE_HTTP_TRANSACTION)
      return;
    if (!(channel instanceof Ci.nsIHttpChannel))
      return;
    channel = channel.QueryInterface(Ci.nsIHttpChannel);
    if (activitySubtype === Ci.nsIHttpActivityObserver.ACTIVITY_SUBTYPE_REQUEST_HEADER) {
      this._onWillSendRequest(channel, timestamp, extraStringData);
    }
  }

  _onWillSendRequest(channel, timestamp, extraStringData) {
    if (!channel.URI.spec.includes('localhost'))
      return;
    dump('>>>>>--------------------------\n');
    for (let i in channel) {
      // dump(' -- ' + i + '\n');
    }
    dump(channel.requestMethod + ' ' + channel.URI.spec + '\n');
    dump('[chrome] channel.loadInfo.innerWindowID: ' + channel.loadInfo.innerWindowID + '\n');
    dump('[chrome] channel.loadInfo.outerWindowID: ' + channel.loadInfo.outerWindowID + '\n');
    dump('[chrome] channel.channelId: ' + channel.channelId+ '\n');
    dump('[chrome] channel.topLevelContentWindowId: ' + channel.topLevelContentWindowId+ '\n');
    dump('[chrome] channel.topLevelOuterContentWindowId: ' + channel.topLevelOuterContentWindowId+ '\n');
    dump('<<<<<<--------------------------\n');
  }
}

var EXPORTED_SYMBOLS = ['NetworkObserver'];
this.NetworkObserver = NetworkObserver;
