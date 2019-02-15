"use strict";

const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
const FRAME_SCRIPT = "chrome://juggler/content/content/ContentSession.js";
const helper = new Helper();

class PageHandler {
  constructor(chromeSession, contentSession, target) {
    this._pageId = target.id();
    this._chromeSession = chromeSession;
    this._contentSession = contentSession;
    this._tab = target.tab();
    this._browser = this._tab.linkedBrowser;
    this._dialogs = new Map();

    this._updateModalDialogs();

    this._eventListeners = [
      helper.addEventListener(this._browser, 'DOMWillOpenModalDialog', async (event) => {
        // wait for the dialog to be actually added to DOM.
        await Promise.resolve();
        this._updateModalDialogs();
      }),
      helper.addEventListener(this._browser, 'DOMModalDialogClosed', event => this._updateModalDialogs()),
    ];
  }

  dispose() {
    helper.removeListeners(this._eventListeners);
  }

  async setViewport({viewport}) {
    if (viewport) {
      const {width, height} = viewport;
      this._browser.style.setProperty('min-width', width + 'px');
      this._browser.style.setProperty('min-height', height + 'px');
      this._browser.style.setProperty('max-width', width + 'px');
      this._browser.style.setProperty('max-height', height + 'px');
    } else {
      this._browser.style.removeProperty('min-width');
      this._browser.style.removeProperty('min-height');
      this._browser.style.removeProperty('max-width');
      this._browser.style.removeProperty('max-height');
    }
    const dimensions = this._browser.getBoundingClientRect();
    await Promise.all([
      this._contentSession.send('setViewport', {
        deviceScaleFactor: viewport ? viewport.deviceScaleFactor : 0,
        isMobile: viewport && viewport.isMobile,
        hasTouch: viewport && viewport.hasTouch,
      }),
      this._contentSession.send('awaitViewportDimensions', {
        width: dimensions.width,
        height: dimensions.height
      }),
    ]);
  }

  _updateModalDialogs() {
    const elements = new Set(this._browser.parentNode.getElementsByTagNameNS(XUL_NS, "tabmodalprompt"));
    for (const dialog of this._dialogs.values()) {
      if (!elements.has(dialog.element())) {
        this._dialogs.delete(dialog.id());
        this._chromeSession.emitEvent('Page.dialogClosed', {
          pageId: this._pageId,
          dialogId: dialog.id(),
        });
      } else {
        elements.delete(dialog.element());
      }
    }
    for (const element of elements) {
      const dialog = Dialog.createIfSupported(element);
      if (!dialog)
        continue;
      this._dialogs.set(dialog.id(), dialog);
      this._chromeSession.emitEvent('Page.dialogOpened', {
        pageId: this._pageId,
        dialogId: dialog.id(),
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
      });
    }
  }

  url() {
    return this._browser.currentURI.spec;
  }

  tab() {
    return this._tab;
  }

  id() {
    return this._pageId;
  }

  async setUserAgent(options) {
    return await this._contentSession.send('setUserAgent', options);
  }

  async setJavascriptEnabled(options) {
    return await this._contentSession.send('setJavascriptEnabled', options);
  }

  async setCacheDisabled(options) {
    return await this._contentSession.send('setCacheDisabled', options);
  }

  async screenshot(options) {
    return await this._contentSession.send('screenshot', options);
  }

  async getBoundingBox(options) {
    return await this._contentSession.send('getBoundingBox', options);
  }

  async getContentQuads(options) {
    return await this._contentSession.send('getContentQuads', options);
  }

  /**
   * @param {{frameId: string, url: string}} options
   */
  async navigate(options) {
    return await this._contentSession.send('navigate', options);
  }

  /**
   * @param {{frameId: string, url: string}} options
   */
  async goBack(options) {
    return await this._contentSession.send('goBack', options);
  }

  /**
   * @param {{frameId: string, url: string}} options
   */
  async goForward(options) {
    return await this._contentSession.send('goForward', options);
  }

  /**
   * @param {{frameId: string, url: string}} options
   */
  async reload(options) {
    return await this._contentSession.send('reload', options);
  }

  /**
   * @param {{functionText: String, frameId: String}} options
   * @return {!Promise<*>}
   */
  async evaluate(options) {
    return await this._contentSession.send('evaluate', options);
  }

  /**
   * @param {{pageId: String, frameId: String, objectId: String}} options
   * @return {!Promise<*>}
   */
  async contentFrame(options) {
    return await this._contentSession.send('contentFrame', options);
  }

  async getObjectProperties(options) {
    return await this._contentSession.send('getObjectProperties', options);
  }

  async addScriptToEvaluateOnNewDocument(options) {
    return await this._contentSession.send('addScriptToEvaluateOnNewDocument', options);
  }

  async removeScriptToEvaluateOnNewDocument(options) {
    return await this._contentSession.send('removeScriptToEvaluateOnNewDocument', options);
  }

  async disposeObject(options) {
    return await this._contentSession.send('disposeObject', options);
  }

  async dispatchKeyEvent(options) {
    return await this._contentSession.send('dispatchKeyEvent', options);
  }

  async dispatchMouseEvent(options) {
    return await this._contentSession.send('dispatchMouseEvent', options);
  }

  async insertText(options) {
    return await this._contentSession.send('insertText', options);
  }

  async handleDialog({dialogId, accept, promptText}) {
    const dialog = this._dialogs.get(dialogId);
    if (!dialog)
      throw new Error('Failed to find dialog with id = ' + dialogId);
    if (accept)
      dialog.accept(promptText);
    else
      dialog.dismiss();
  }
}

class Dialog {
  static createIfSupported(element) {
    const type = element.Dialog.args.promptType;
    switch (type) {
      case 'alert':
      case 'prompt':
      case 'confirm':
        return new Dialog(element, type);
      case 'confirmEx':
        return new Dialog(element, 'beforeunload');
      default:
        return null;
    };
  }

  constructor(element, type) {
    this._id = helper.generateId();
    this._type = type;
    this._element = element;
  }

  id() {
    return this._id;
  }

  message() {
    return this._element.ui.infoBody.textContent;
  }

  type() {
    return this._type;
  }

  element() {
    return this._element;
  }

  dismiss() {
    if (this._element.ui.button1)
      this._element.ui.button1.click();
    else
      this._element.ui.button0.click();
  }

  defaultValue() {
    return this._element.ui.loginTextbox.value;
  }

  accept(promptValue) {
    if (typeof promptValue === 'string' && this._type === 'prompt')
      this._element.ui.loginTextbox.value = promptValue;
    this._element.ui.button0.click();
  }
}

var EXPORTED_SYMBOLS = ['PageHandler'];
this.PageHandler = PageHandler;
