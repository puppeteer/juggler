"use strict";

const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');
const {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const helper = new Helper();

class RuntimeHandler {
  constructor(chromeSession, contentSession) {
    this._chromeSession = chromeSession;
    this._contentSession = contentSession;
  }

  /**
   * @param {{functionText: String, frameId: String}} options
   * @return {!Promise<*>}
   */
  async evaluate(options) {
    return await this._contentSession.send('evaluate', options);
  }

  async getObjectProperties(options) {
    return await this._contentSession.send('getObjectProperties', options);
  }

  async disposeObject(options) {
    return await this._contentSession.send('disposeObject', options);
  }

  dispose() {}
}

var EXPORTED_SYMBOLS = ['RuntimeHandler'];
this.RuntimeHandler = RuntimeHandler;
