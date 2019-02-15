const {BrowserHandler} = ChromeUtils.import("chrome://juggler/content/BrowserHandler.js");
const {PageHandler} = ChromeUtils.import("chrome://juggler/content/PageHandler.js");
const {TargetRegistry} = ChromeUtils.import("chrome://juggler/content/TargetRegistry.js");
const {protocol, checkScheme} = ChromeUtils.import("chrome://juggler/content/Protocol.js");
const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');
const helper = new Helper();

class ChromeSession {
  /**
   * @param {Connection} connection
   * @param {BrowserContextManager} contextManager
   * @param {NetworkObserver} networkObserver
   * @param {TargetRegistry} targetRegistry
   */
  constructor(connection, contextManager, networkObserver, targetRegistry) {
    this._connection = connection;
    this._connection.onmessage = this._dispatch.bind(this);

    this._contextManager = contextManager;
    this._networkObserver = networkObserver;
    this._targetRegistry = targetRegistry;

    this._browserHandler = new BrowserHandler(this);

    this._domainConstructors = {
      Page: PageHandler,
    };
    this._targetDomainHandlers = new Map();

    this._eventListeners = [
      helper.on(this._targetRegistry, TargetRegistry.Events.TargetDestroyed, this._onTargetDestroyed.bind(this)),
    ];
  }

  async _createDomainHandler(targetId, domainName) {
    if (!this._domainConstructors[domainName])
      throw new Error('Cannot enable domain ' + domainName + ' for page target ' + targetId);
    const target = this._targetRegistry.target(targetId);
    if (!target)
      throw new Error(`Cannot find target ${targetId}`);
    if (target.type() !== 'page')
      throw new Error('Cannot enable domain for non-page target');

    let handlers = this._targetDomainHandlers.get(targetId);
    if (!handlers) {
      handlers = {
        contentSession: null,
      };
      this._targetDomainHandlers.set(targetId, handlers);
    }
    if (handlers[domainName])
      throw new Error('Domain ' + domainName + ' is already enabled');
    if (!handlers.contentSession) {
      handlers.contentSession = new ContentSession(this, target.tab().linkedBrowser, targetId);
      await handlers.contentSession.send('enable');
    }
    handlers[domainName] = new this._domainConstructors[domainName](this, handlers.contentSession, target);
  }

  _disposeTargetDomainHandlers(targetId) {
    const handlers = this._targetDomainHandlers.get(targetId);
    if (!handlers)
      return;
    for (let [key, handler] of Object.entries(handlers)) {
      // Destroy content session in the very end.
      if (key === 'contentSession')
        continue;
      handler.dispose();
    }
    if (handlers.contentSession)
      handlers.contentSession.dispose();
    this._targetDomainHandlers.delete(targetId);
  }

  _onTargetDestroyed(target) {
    this._disposeTargetDomainHandlers(target.id());
  }

  dispose() {
    helper.removeListeners(this._eventListeners);
    for (const targetId of Object.keys(this._targetDomainHandlers))
      this._disposeTargetDomainHandlers(targetId);
    this._targetDomainHandlers.clear();
    this._browserHandler.dispose();
  }

  contextManager() {
    return this._contextManager;
  }

  targetRegistry() {
    return this._targetRegistry;
  }

  networkObserver() {
    return this._networkObserver;
  }

  emitEvent(eventName, params) {
    const [domain, eName] = eventName.split('.');
    const scheme = protocol.domains[domain] ? protocol.domains[domain].events[eName] : null;
    if (!scheme)
      throw new Error(`ERROR: event '${eventName}' is not supported`);
    const details = {};
    if (!checkScheme(scheme, params || {}, details))
      throw new Error(`ERROR: failed to emit event '${eventName}' ${JSON.stringify(params, null, 2)}\n${details.error}`);
    this._connection.send({method: eventName, params});
  }

  async _dispatch(data) {
    const id = data.id;
    try {
      const method = data.method;
      const params = data.params || {};
      if (!id)
        throw new Error(`ERROR: every message must have an 'id' parameter`);
      if (!method)
        throw new Error(`ERROR: every message must have a 'method' parameter`);

      const [domain, methodName] = method.split('.');
      const descriptor = protocol.domains[domain] ? protocol.domains[domain].methods[methodName] : null;
      if (!descriptor)
        throw new Error(`ERROR: method '${method}' is not supported`);
      let details = {};
      if (!checkScheme(descriptor.params || {}, params, details))
        throw new Error(`ERROR: failed to call method '${method}' with parameters ${JSON.stringify(params, null, 2)}\n${details.error}`);

      const result = await this._innerDispatch(method, params);

      details = {};
      if ((descriptor.returns || result) && !checkScheme(descriptor.returns, result, details))
        throw new Error(`ERROR: failed to dispatch method '${method}' result ${JSON.stringify(result, null, 2)}\n${details.error}`);

      this._connection.send({id, result});
    } catch (e) {
      this._connection.send({id, error: {
        message: e.message,
        data: e.stack
      }});
    }
  }

  async _innerDispatch(method, params) {
    const [domainName, methodName] = method.split('.');
    if (domainName === 'Browser')
      return await this._browserHandler[methodName](params);
    if (methodName === 'enable') {
      await this._createDomainHandler(params.pageId, domainName);
      return;
    }
    const handlers = this._targetDomainHandlers.get(params.pageId);
    if (!handlers || !handlers[domainName])
      throw new Error(`Domain ${domainName} is not enabled`);
    return await handlers[domainName][methodName](params);
  }
}

class ContentSession {
  constructor(chromeSession, browser, pageId) {
    this._chromeSession = chromeSession;
    this._browser = browser;
    this._pageId = pageId;
    this._messageId = 0;
    this._pendingMessages = new Map();
    this._sessionId = helper.generateId();
    this._browser.messageManager.sendAsyncMessage('juggler:create-content-session', this._sessionId);
    this._eventListeners = [
      helper.addMessageListener(this._browser.messageManager, this._sessionId, {
        receiveMessage: message => this._onMessage(message)
      }),
    ];
  }

  dispose() {
    helper.removeListeners(this._eventListeners);
    for (const {resolve, reject} of this._pendingMessages.values())
      reject(new Error('Page closed.'));
    this._pendingMessages.clear();
    if (this._browser.messageManager)
      this._browser.messageManager.sendAsyncMessage('juggler:dispose-content-session', this._sessionId);
  }

  /**
   * @param {string} methodName
   * @param {*} params
   * @return {!Promise<*>}
   */
  send(methodName, params) {
    const id = ++this._messageId;
    const promise = new Promise((resolve, reject) => {
      this._pendingMessages.set(id, {resolve, reject});
    });
    this._browser.messageManager.sendAsyncMessage(this._sessionId, {id, methodName, params});
    return promise;
  }

  _onMessage({data}) {
    if (data.id) {
      let id = data.id;
      const {resolve, reject} = this._pendingMessages.get(data.id);
      this._pendingMessages.delete(data.id);
      if (data.error)
        reject(new Error(data.error));
      else
        resolve(data.result);
    } else {
      const {
        eventName,
        params = {}
      } = data;
      params.pageId = this._pageId;
      this._chromeSession.emitEvent(eventName, params);
    }
  }
}


this.EXPORTED_SYMBOLS = ['ChromeSession'];
this.ChromeSession = ChromeSession;

