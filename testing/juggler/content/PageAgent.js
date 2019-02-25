"use strict";
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');
const {NetUtil} = ChromeUtils.import('resource://gre/modules/NetUtil.jsm');

const helper = new Helper();

class PageAgent {
  constructor(session, runtimeAgent, frameTree, scrollbarManager, networkMonitor) {
    this._session = session;
    this._runtime = runtimeAgent;
    this._frameTree = frameTree;
    this._networkMonitor = networkMonitor;
    this._scrollbarManager = scrollbarManager;

    this._frameToExecutionContext = new Map();
    this._scriptsToEvaluateOnNewDocument = new Map();
    this._bindingsToAdd = new Set();

    const disallowedMessageCategories = new Set([
      'XPConnect JavaScript',
      'component javascript',
      'chrome javascript',
      'chrome registration',
      'XBL',
      'XBL Prototype Handler',
      'XBL Content Sink',
      'xbl javascript',
    ]);
    this._consoleServiceListener = {
      QueryInterface: ChromeUtils.generateQI([Ci.nsIConsoleListener]),

      observe: message => {
        if (!(message instanceof Ci.nsIScriptError) || !message.outerWindowID ||
            !message.category || disallowedMessageCategories.has(message.category)) {
          return;
        }
        const errorWindow = Services.wm.getOuterWindowWithId(message.outerWindowID);
        const frame = errorWindow ? this._frameTree.frameForDocShell(errorWindow.docShell) : null;
        const executionContext = this._frameToExecutionContext.get(frame);
        if (!executionContext)
          return;
        const typeNames = {
          [Ci.nsIConsoleMessage.debug]: 'debug',
          [Ci.nsIConsoleMessage.info]: 'info',
          [Ci.nsIConsoleMessage.warn]: 'warn',
          [Ci.nsIConsoleMessage.error]: 'error',
        };
        this._session.emitEvent('Page.console', {
          args: [{
            value: message.message,
          }],
          type: typeNames[message.logLevel],
          executionContextId: executionContext.id(),
          location: {
            lineNumber: message.lineNumber,
            columnNumber: message.columnNumber,
            url: message.sourceName,
          },
        });
      },
    };

    this._eventListeners = [];
    this._enabled = false;

    const docShell = frameTree.mainFrame().docShell();
    this._initialDPPX = docShell.contentViewer.overrideDPPX;
    this._customScrollbars = null;
  }

  async awaitViewportDimensions({width, height}) {
    const win = this._frameTree.mainFrame().domWindow();
    if (win.innerWidth === width && win.innerHeight === height)
      return;
    await new Promise(resolve => {
      const listener = helper.addEventListener(win, 'resize', () => {
        if (win.innerWidth === width && win.innerHeight === height) {
          helper.removeListeners([listener]);
          resolve();
        }
      });
    });
  }

  requestDetails({channelId}) {
    return this._networkMonitor.requestDetails(channelId);
  }

  async setViewport({deviceScaleFactor, isMobile, hasTouch}) {
    const docShell = this._frameTree.mainFrame().docShell();
    docShell.contentViewer.overrideDPPX = deviceScaleFactor || this._initialDPPX;
    docShell.deviceSizeIsPageSize = isMobile;
    docShell.touchEventsOverride = hasTouch ? Ci.nsIDocShell.TOUCHEVENTS_OVERRIDE_ENABLED : Ci.nsIDocShell.TOUCHEVENTS_OVERRIDE_NONE;
    this._scrollbarManager.setFloatingScrollbars(isMobile);
  }

  async setEmulatedMedia({media}) {
    const docShell = this._frameTree.mainFrame().docShell();
    if (media)
      docShell.contentViewer.emulateMedium(media);
    else
      docShell.contentViewer.stopEmulatingMedium();
  }

  async setUserAgent({userAgent}) {
    const docShell = this._frameTree.mainFrame().docShell();
    docShell.customUserAgent = userAgent;
  }

  addScriptToEvaluateOnNewDocument({script}) {
    const scriptId = helper.generateId();
    this._scriptsToEvaluateOnNewDocument.set(scriptId, script);
    return {scriptId};
  }

  removeScriptToEvaluateOnNewDocument({scriptId}) {
    this._scriptsToEvaluateOnNewDocument.delete(scriptId);
  }

  setCacheDisabled({cacheDisabled}) {
    const enable = Ci.nsIRequest.LOAD_NORMAL;
    const disable = Ci.nsIRequest.LOAD_BYPASS_CACHE |
                  Ci.nsIRequest.INHIBIT_CACHING;

    const docShell = this._frameTree.mainFrame().docShell();
    docShell.defaultLoadFlags = cacheDisabled ? disable : enable;
  }

  setJavascriptEnabled({enabled}) {
    const docShell = this._frameTree.mainFrame().docShell();
    docShell.allowJavascript = enabled;
  }

  enable() {
    if (this._enabled)
      return;

    this._enabled = true;
    // Dispatch frameAttached events for all initial frames
    for (const frame of this._frameTree.frames()) {
      this._onFrameAttached(frame);
      if (frame.url())
        this._onNavigationCommitted(frame);
      if (frame.pendingNavigationId())
        this._onNavigationStarted(frame);
    }
    Services.console.registerListener(this._consoleServiceListener);
    this._eventListeners = [
      () => Services.console.unregisterListener(this._consoleServiceListener),
      helper.addObserver(this._consoleAPICalled.bind(this), "console-api-log-event"),
      helper.addObserver(this._onDOMWindowCreated.bind(this), 'content-document-global-created'),
      helper.addEventListener(this._session.mm(), 'DOMContentLoaded', this._onDOMContentLoaded.bind(this)),
      helper.addEventListener(this._session.mm(), 'pageshow', this._onLoad.bind(this)),
      helper.addEventListener(this._session.mm(), 'error', this._onError.bind(this)),
      helper.on(this._frameTree, 'frameattached', this._onFrameAttached.bind(this)),
      helper.on(this._frameTree, 'framedetached', this._onFrameDetached.bind(this)),
      helper.on(this._frameTree, 'navigationstarted', this._onNavigationStarted.bind(this)),
      helper.on(this._frameTree, 'navigationcommitted', this._onNavigationCommitted.bind(this)),
      helper.on(this._frameTree, 'navigationaborted', this._onNavigationAborted.bind(this)),
      helper.on(this._frameTree, 'samedocumentnavigation', this._onSameDocumentNavigation.bind(this)),
    ];
  }

  _onDOMContentLoaded(event) {
    const docShell = event.target.ownerGlobal.docShell;
    const frame = this._frameTree.frameForDocShell(docShell);
    if (!frame)
      return;
    this._session.emitEvent('Page.eventFired', {
      frameId: frame.id(),
      name: 'DOMContentLoaded',
    });
  }

  _onError(errorEvent) {
    const docShell = errorEvent.target.ownerGlobal.docShell;
    const frame = this._frameTree.frameForDocShell(docShell);
    if (!frame)
      return;
    this._session.emitEvent('Page.uncaughtError', {
      frameId: frame.id(),
      message: errorEvent.message,
      stack: errorEvent.error.stack
    });
  }

  _onLoad(event) {
    const docShell = event.target.ownerGlobal.docShell;
    const frame = this._frameTree.frameForDocShell(docShell);
    if (!frame)
      return;
    this._session.emitEvent('Page.eventFired', {
      frameId: frame.id(),
      name: 'load'
    });
  }

  _onNavigationStarted(frame) {
    this._session.emitEvent('Page.navigationStarted', {
      frameId: frame.id(),
      navigationId: frame.pendingNavigationId(),
      url: frame.pendingNavigationURL(),
    });
  }

  _onNavigationAborted(frame, navigationId, errorText) {
    this._session.emitEvent('Page.navigationAborted', {
      frameId: frame.id(),
      navigationId,
      errorText,
    });
  }

  _onSameDocumentNavigation(frame) {
    this._session.emitEvent('Page.sameDocumentNavigation', {
      frameId: frame.id(),
      url: frame.url(),
    });
  }

  _onNavigationCommitted(frame) {
    this._session.emitEvent('Page.navigationCommitted', {
      frameId: frame.id(),
      navigationId: frame.lastCommittedNavigationId(),
      url: frame.url(),
      name: frame.name(),
    });
  }

  _onDOMWindowCreated(window) {
    const docShell = window.docShell;
    const frame = this._frameTree.frameForDocShell(docShell);
    if (!frame)
      return;

    if (this._frameToExecutionContext.has(frame)) {
      this._runtime.destroyExecutionContext(this._frameToExecutionContext.get(frame));
      this._frameToExecutionContext.delete(frame);
    }
    const executionContext = this._ensureExecutionContext(frame);

    if (!this._scriptsToEvaluateOnNewDocument.size && !this._bindingsToAdd.size)
      return;
    for (const bindingName of this._bindingsToAdd.values())
      this._exposeFunction(frame, bindingName);
    for (const script of this._scriptsToEvaluateOnNewDocument.values()) {
      try {
        let result = executionContext.evaluateScript(script);
        if (result && result.objectId)
          executionContext.disposeObject(result.objectId);
      } catch (e) {
      }
    }
  }

  _onFrameAttached(frame) {
    this._session.emitEvent('Page.frameAttached', {
      frameId: frame.id(),
      parentFrameId: frame.parentFrame() ? frame.parentFrame().id() : undefined,
    });
    this._ensureExecutionContext(frame);
  }

  _onFrameDetached(frame) {
    this._session.emitEvent('Page.frameDetached', {
      frameId: frame.id(),
    });
  }

  _ensureExecutionContext(frame) {
    let executionContext = this._frameToExecutionContext.get(frame);
    if (!executionContext) {
      executionContext = this._runtime.createExecutionContext(frame.domWindow(), {
        frameId: frame.id(),
      });
      this._frameToExecutionContext.set(frame, executionContext);
    }
    return executionContext;
  }

  dispose() {
    helper.removeListeners(this._eventListeners);
  }

  _consoleAPICalled({wrappedJSObject}, topic, data) {
    const levelToType = {
      'dir': 'dir',
      'log': 'log',
      'debug': 'debug',
      'info': 'info',
      'error': 'error',
      'warn': 'warning',
      'dirxml': 'dirxml',
      'table': 'table',
      'trace': 'trace',
      'clear': 'clear',
      'group': 'startGroup',
      'groupCollapsed': 'startGroupCollapsed',
      'groupEnd': 'endGroup',
      'assert': 'assert',
      'profile': 'profile',
      'profileEnd': 'profileEnd',
      'count': 'count',
      'countReset': 'countReset',
      'time': null,
      'timeLog': 'timeLog',
      'timeEnd': 'timeEnd',
      'timeStamp': 'timeStamp',
    };
    const type = levelToType[wrappedJSObject.level];
    if (!type) return;
    let messageFrame = null;
    for (const frame of this._frameTree.frames()) {
      const domWindow = frame.domWindow();
      if (domWindow && domWindow.windowUtils.currentInnerWindowID === wrappedJSObject.innerID) {
        messageFrame = frame;
        break;
      }
    }
    const executionContext = this._frameToExecutionContext.get(messageFrame);
    if (!executionContext)
      return;
    const args = wrappedJSObject.arguments.map(arg => executionContext.rawValueToRemoteObject(arg));
    this._session.emitEvent('Page.console', {
      args,
      type,
      executionContextId: executionContext.id(),
      location: {
        lineNumber: wrappedJSObject.lineNumber - 1,
        columnNumber: wrappedJSObject.columnNumber - 1,
        url: wrappedJSObject.filename,
      },
    });
  }

  async navigate({frameId, url, referer}) {
    try {
      const uri = NetUtil.newURI(url);
    } catch (e) {
      throw new Error(`Invalid url: "${url}"`);
    }
    let referrerURI = null;
    if (referer) {
      try {
        referrerURI = NetUtil.newURI(referer);
      } catch (e) {
        throw new Error(`Invalid referer: "${referer}"`);
      }
    }
    const frame = this._frameTree.frame(frameId);
    const docShell = frame.docShell().QueryInterface(Ci.nsIWebNavigation);
    docShell.loadURI(url, Ci.nsIWebNavigation.LOAD_FLAGS_NONE, referrerURI, null /* postData */, null /* headers */);
    return {navigationId: frame.pendingNavigationId(), navigationURL: frame.pendingNavigationURL()};
  }

  async reload({frameId, url}) {
    const frame = this._frameTree.frame(frameId);
    const docShell = frame.docShell().QueryInterface(Ci.nsIWebNavigation);
    docShell.reload(Ci.nsIWebNavigation.LOAD_FLAGS_NONE);
    return {navigationId: frame.pendingNavigationId(), navigationURL: frame.pendingNavigationURL()};
  }

  async goBack({frameId, url}) {
    const frame = this._frameTree.frame(frameId);
    const docShell = frame.docShell();
    if (!docShell.canGoBack)
      return {navigationId: null, navigationURL: null};
    docShell.goBack();
    return {navigationId: frame.pendingNavigationId(), navigationURL: frame.pendingNavigationURL()};
  }

  async goForward({frameId, url}) {
    const frame = this._frameTree.frame(frameId);
    const docShell = frame.docShell();
    if (!docShell.canGoForward)
      return {navigationId: null, navigationURL: null};
    docShell.goForward();
    return {navigationId: frame.pendingNavigationId(), navigationURL: frame.pendingNavigationURL()};
  }

  addBinding({name}) {
    if (this._bindingsToAdd.has(name))
      throw new Error(`Binding with name ${name} already exists`);
    this._bindingsToAdd.add(name);
    for (const frame of this._frameTree.frames())
      this._exposeFunction(frame, name);
  }

  _exposeFunction(frame, name) {
    Cu.exportFunction((...args) => {
      const executionContext = this._ensureExecutionContext(frame);
      this._session.emitEvent('Page.bindingCalled', {
        executionContextId: executionContext.id(),
        name,
        payload: args[0]
      });
    }, frame.domWindow(), {
      defineAs: name,
    });
  }

  async setFileInputFiles({objectId, frameId, files}) {
    const frame = this._frameTree.frame(frameId);
    if (!frame)
      throw new Error('Failed to find frame with id = ' + frameId);
    const executionContext = this._ensureExecutionContext(frame);
    const unsafeObject = executionContext.unsafeObject(objectId);
    if (!unsafeObject)
      throw new Error('Object is not input!');
    const nsFiles = await Promise.all(files.map(filePath => File.createFromFileName(filePath)));
    unsafeObject.mozSetFileArray(nsFiles);
  }

  getContentQuads({objectId, frameId}) {
    const frame = this._frameTree.frame(frameId);
    if (!frame)
      throw new Error('Failed to find frame with id = ' + frameId);
    const executionContext = this._ensureExecutionContext(frame);
    const unsafeObject = executionContext.unsafeObject(objectId);
    if (!unsafeObject.getBoxQuads)
      throw new Error('RemoteObject is not a node');
    const quads = unsafeObject.getBoxQuads({relativeTo: this._frameTree.mainFrame().domWindow().document}).map(quad => {
      return {
        p1: {x: quad.p1.x, y: quad.p1.y},
        p2: {x: quad.p2.x, y: quad.p2.y},
        p3: {x: quad.p3.x, y: quad.p3.y},
        p4: {x: quad.p4.x, y: quad.p4.y},
      };
    });
    return {quads};
  }

  contentFrame({objectId, frameId}) {
    const frame = this._frameTree.frame(frameId);
    if (!frame)
      throw new Error('Failed to find frame with id = ' + frameId);
    const executionContext = this._ensureExecutionContext(frame);
    const unsafeObject = executionContext.unsafeObject(objectId);
    if (!unsafeObject.contentWindow)
      return null;
    const contentFrame = this._frameTree.frameForDocShell(unsafeObject.contentWindow.docShell);
    return {frameId: contentFrame.id()};
  }

  async getBoundingBox({frameId, objectId}) {
    const frame = this._frameTree.frame(frameId);
    if (!frame)
      throw new Error('Failed to find frame with id = ' + frameId);
    const executionContext = this._ensureExecutionContext(frame);
    const unsafeObject = executionContext.unsafeObject(objectId);
    if (!unsafeObject.getBoxQuads)
      throw new Error('RemoteObject is not a node');
    const quads = unsafeObject.getBoxQuads({relativeTo: this._frameTree.mainFrame().domWindow().document});
    if (!quads.length)
      return null;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const quad of quads) {
      const boundingBox = quad.getBounds();
      x1 = Math.min(boundingBox.x, x1);
      y1 = Math.min(boundingBox.y, y1);
      x2 = Math.max(boundingBox.x + boundingBox.width, x2);
      y2 = Math.max(boundingBox.y + boundingBox.height, y2);
    }
    return {x: x1 + frame.domWindow().scrollX, y: y1 + frame.domWindow().scrollY, width: x2 - x1, height: y2 - y1};
  }

  async screenshot({mimeType, fullPage, clip}) {
    const content = this._session.mm().content;
    if (clip) {
      const data = takeScreenshot(content, clip.x, clip.y, clip.width, clip.height, mimeType);
      return {data};
    }
    if (fullPage) {
      const rect = content.document.documentElement.getBoundingClientRect();
      const width = content.innerWidth + content.scrollMaxX - content.scrollMinX;
      const height = content.innerHeight + content.scrollMaxY - content.scrollMinY;
      const data = takeScreenshot(content, 0, 0, width, height, mimeType);
      return {data};
    }
    const data = takeScreenshot(content, content.scrollX, content.scrollY, content.innerWidth, content.innerHeight, mimeType);
    return {data};
  }

  async dispatchKeyEvent({type, keyCode, code, key, repeat, location}) {
    const frame = this._frameTree.mainFrame();
    const tip = frame.textInputProcessor();
    let keyEvent = new (frame.domWindow().KeyboardEvent)("", {
      key,
      code,
      location,
      repeat,
      keyCode
    });
    const flags = 0;
    if (type === 'keydown')
      tip.keydown(keyEvent, flags);
    else if (type === 'keyup')
      tip.keyup(keyEvent, flags);
    else
      throw new Error(`Unknown type ${type}`);
  }

  async dispatchMouseEvent({type, x, y, button, clickCount, modifiers, buttons}) {
    const frame = this._frameTree.mainFrame();
    frame.domWindow().windowUtils.sendMouseEvent(
      type,
      x,
      y,
      button,
      clickCount,
      modifiers,
      false /*aIgnoreRootScrollFrame*/,
      undefined /*pressure*/,
      undefined /*inputSource*/,
      undefined /*isDOMEventSynthesized*/,
      undefined /*isWidgetEventSynthesized*/,
      buttons);
    if (type === 'mousedown' && button === 2) {
      frame.domWindow().windowUtils.sendMouseEvent(
        'contextmenu',
        x,
        y,
        button,
        clickCount,
        modifiers,
        false /*aIgnoreRootScrollFrame*/,
        undefined /*pressure*/,
        undefined /*inputSource*/,
        undefined /*isDOMEventSynthesized*/,
        undefined /*isWidgetEventSynthesized*/,
        buttons);
    }
  }

  async insertText({text}) {
    const frame = this._frameTree.mainFrame();
    frame.textInputProcessor().commitCompositionWith(text);
  }
}

function takeScreenshot(win, left, top, width, height, mimeType) {
  const MAX_SKIA_DIMENSIONS = 32767;

  const scale = win.devicePixelRatio;
  const canvasWidth = width * scale;
  const canvasHeight = height * scale;

  if (canvasWidth > MAX_SKIA_DIMENSIONS || canvasHeight > MAX_SKIA_DIMENSIONS)
    throw new Error('Cannot take screenshot larger than ' + MAX_SKIA_DIMENSIONS);

  const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  let ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawWindow(win, left, top, width, height, 'rgb(255,255,255)', ctx.DRAWWINDOW_DRAW_CARET);
  const dataURL = canvas.toDataURL(mimeType);
  return dataURL.substring(dataURL.indexOf(',') + 1);
};

var EXPORTED_SYMBOLS = ['PageAgent'];
this.PageAgent = PageAgent;

