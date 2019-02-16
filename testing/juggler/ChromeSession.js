const {BrowserHandler} = ChromeUtils.import("chrome://juggler/content/BrowserHandler.js");
const {PageHandler} = ChromeUtils.import("chrome://juggler/content/PageHandler.js");
const {NetworkHandler} = ChromeUtils.import("chrome://juggler/content/NetworkHandler.js");
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
    this._connection.onclose = this.dispose.bind(this);

    this._contextManager = contextManager;
    this._networkObserver = networkObserver;
    this._targetRegistry = targetRegistry;

    this._browserHandler = new BrowserHandler(this);
    this._targetToDomainHandlers = new Map();

    this._eventListeners = [
      helper.on(this._targetRegistry, TargetRegistry.Events.TargetDestroyed, this._onTargetDestroyed.bind(this)),
    ];
  }

  async _createDomainHandlers(targetId) {
    if (this._targetToDomainHandlers.has(targetId))
      throw new Error('Domain handlers for target ' + targetId + ' are already enabled');
    const tab = this._targetRegistry.tabForTarget(targetId);
    const contentSession = new ContentSession(this, tab.linkedBrowser, targetId);
    await contentSession.send('enable');

    const Page = new PageHandler(this, contentSession, targetId, tab);
    const Network = new NetworkHandler(this, contentSession, targetId, tab);
    this._targetToDomainHandlers.set(targetId, {
      contentSession, Page, Network
    });
  }

  _disposeTargetDomainHandlers(targetId) {
    const handlers = this._targetToDomainHandlers.get(targetId);
    if (!handlers)
      return;
    handlers.Page.dispose();
    handlers.Network.dispose();
    handlers.contentSession.dispose();
    this._targetToDomainHandlers.delete(targetId);
  }

  _onTargetDestroyed({targetId}) {
    this._disposeTargetDomainHandlers(targetId);
  }

  dispose() {
    helper.removeListeners(this._eventListeners);
    for (const targetId of Object.keys(this._targetToDomainHandlers))
      this._disposeTargetDomainHandlers(targetId);
    this._targetToDomainHandlers.clear();
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
    this._connection.send(JSON.stringify({method: eventName, params}));
  }

  async _dispatch(event) {
    const data = JSON.parse(event.data);
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

      this._connection.send(JSON.stringify({id, result}));
    } catch (e) {
      this._connection.send(JSON.stringify({id, error: {
        message: e.message,
        data: e.stack
      }}));
    }
  }

  async _innerDispatch(method, params) {
    if (method === 'Page.enable') {
      await this._createDomainHandlers(params.targetId);
      return;
    }
    const [domainName, methodName] = method.split('.');
    if (domainName === 'Browser')
      return await this._browserHandler[methodName](params);
    const handlers = this._targetToDomainHandlers.get(params.targetId);
    if (!handlers || !handlers[domainName])
      throw new Error(`Domain ${domainName} is not enabled`);
    return await handlers[domainName][methodName](params);
  }
}

class ContentSession {
  constructor(chromeSession, browser, targetId) {
    this._chromeSession = chromeSession;
    this._browser = browser;
    this._targetId = targetId;
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
      params.targetId = this._targetId;
      this._chromeSession.emitEvent(eventName, params);
    }
  }
}


this.EXPORTED_SYMBOLS = ['ChromeSession'];
this.ChromeSession = ChromeSession;

