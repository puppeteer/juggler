const {BrowserHandler} = ChromeUtils.import("chrome://juggler/content/BrowserHandler.jsm");
const {PageHandler} = ChromeUtils.import("chrome://juggler/content/PageHandler.jsm");
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
    this._pageHandlers = new Map();

    this._factories = {
      'Page.enable': ({pageId}) => this._enableHandler(this._pageHandlers, PageHandler, pageId),
    };

    this._eventListeners = [
      helper.on(this._targetRegistry, TargetRegistry.Events.TargetDestroyed, this._onTargetDestroyed.bind(this)),
    ];
  }

  _onTargetDestroyed(target) {
    const pageHandler = this._pageHandlers.get(target.id());
    if (pageHandler) {
      pageHandler.dispose();
      this._pageHandlers.delete(target.id());
    }
  }

  dispose() {
    helper.removeListeners(this._eventListeners);
    for (const pageHandler of this._pageHandlers.values())
      pageHandler.dispose();
    this._pageHandlers.clear();
    this._browserHandler.dispose();
  }

  async _enableHandler(map, classType, targetId) {
    if (map.has(targetId))
      throw new Error('Already enabled!');
    const target = this._targetRegistry.target(targetId);
    if (!target)
      throw new Error(`Cannot find target ${targetId}`);
    const instance = await classType.create(this, target);
    map.set(targetId, instance);
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
    if (!params.pageId)
      throw new Error(`Parameter "pageId" must be present for ${domainName}.* methods`);
    if (this._factories[method])
      return await this._factories[method](params);
    if (domainName === 'Page') {
      const pageHandler = this._pageHandlers.get(params.pageId);
      if (!pageHandler)
        throw new Error('Failed to find page for id = ' + pageId);
      return await pageHandler[methodName](params);
    }
    throw new Error(`INTERNAL ERROR: failed to dispatch '${method}'`);
  }
}

this.EXPORTED_SYMBOLS = ['ChromeSession'];
this.ChromeSession = ChromeSession;

