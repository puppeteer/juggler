const {t, checkScheme} = ChromeUtils.import('chrome://juggler/content/protocol/PrimitiveTypes.js');

// Protocol-specific types.
const types = {};

types.TargetInfo = {
  type: t.Enum(['page', 'browser']),
  targetId: t.String,
  browserContextId: t.Optional(t.String),
  url: t.String,
  // PageId of parent tab, if any.
  openerId: t.Optional(t.String),
};

const Browser = {
  targets: ['browser'],

  events: {},

  methods: {
    'close': {},
    'getInfo': {
      returns: {
        userAgent: t.String,
        version: t.String,
      },
    },
    'setIgnoreHTTPSErrors': {
      params: {
        enabled: t.Boolean,
      },
    },
    'grantPermissions': {
      params: {
        origin: t.String,
        browserContextId: t.Optional(t.String),
        permissions: t.Array(t.Enum([
          'geo', 'microphone', 'camera', 'desktop-notifications'
        ])),
      },
    },
    'resetPermissions': {
      params: {
        browserContextId: t.Optional(t.String),
      }
    },
  },
};

const Target = {
  targets: ['browser'],

  events: {
    'attachedToTarget': {
      sessionId: t.String,
      targetInfo: types.TargetInfo,
    },
    'detachedFromTarget': {
      sessionId: t.String,
    },
    'targetCreated': types.TargetInfo,
    'targetDestroyed': types.TargetInfo,
    'targetInfoChanged': types.TargetInfo,
  },

  methods: {
    // Start emitting tagOpened/tabClosed events
    'enable': {},
    'attachToTarget': {
      params: {
        targetId: t.String,
      },
      returns: {
        sessionId: t.String,
      },
    },
    'newPage': {
      params: {
        browserContextId: t.Optional(t.String),
      },
      returns: {
        targetId: t.String,
      }
    },
    'createBrowserContext': {
      returns: {
        browserContextId: t.String,
      },
    },
    'removeBrowserContext': {
      params: {
        browserContextId: t.String,
      },
    },
    'getBrowserContexts': {
      returns: {
        browserContextIds: t.Array(t.String),
      },
    },
  },
};

types.DOMPoint = {
  x: t.Number,
  y: t.Number,
};

types.DOMQuad = {
  p1: types.DOMPoint,
  p2: types.DOMPoint,
  p3: types.DOMPoint,
  p4: types.DOMPoint,
};

types.RemoteObject = t.Either({
  type: t.Enum(['object', 'function', 'undefined', 'string', 'number', 'boolean', 'symbol', 'bigint']),
  subtype: t.Optional(t.Enum(['array', 'null', 'node', 'regexp', 'date', 'map', 'set', 'weakmap', 'weakset', 'error', 'proxy', 'promise', 'typedarray'])),
  objectId: t.String,
}, {
  unserializableValue: t.Enum(['Infinity', '-Infinity', '-0', 'NaN']),
}, {
  value: t.Any
});

const Network = {
  targets: ['page'],
  events: {
    'requestWillBeSent': {
      // frameId may be absent for redirected requests.
      frameId: t.Optional(t.String),
      requestId: t.String,
      // RequestID of redirected request.
      redirectedFrom: t.Optional(t.String),
      postData: t.Optional(t.String),
      headers: t.Array({
        name: t.String,
        value: t.String,
      }),
      suspended: t.Optional(t.Boolean),
      url: t.String,
      method: t.String,
      isNavigationRequest: t.Boolean,
      cause: t.String,
    },
    'responseReceived': {
      securityDetails: t.Nullable({
        protocol: t.String,
        subjectName: t.String,
        issuer: t.String,
        validFrom: t.Number,
        validTo: t.Number,
      }),
      requestId: t.String,
      fromCache: t.Boolean,
      remoteIPAddress: t.Optional(t.String),
      remotePort: t.Optional(t.Number),
      status: t.Number,
      statusText: t.String,
      headers: t.Array({
        name: t.String,
        value: t.String,
      }),
    },
    'requestFinished': {
      requestId: t.String,
    },
    'requestFailed': {
      requestId: t.String,
      errorCode: t.String,
    },
  },
  methods: {
    'enable': {},
    'setRequestInterception': {
      params: {
        enabled: t.Boolean,
      },
    },
    'setExtraHTTPHeaders': {
      params: {
        headers: t.Array({
          name: t.String,
          value: t.String,
        }),
      },
    },
    'abortSuspendedRequest': {
      params: {
        requestId: t.String,
      },
    },
    'resumeSuspendedRequest': {
      params: {
        requestId: t.String,
      },
    },
  },
};

const Page = {
  targets: ['page'],
  events: {
    'eventFired': {
      frameId: t.String,
      name: t.Enum(['load', 'DOMContentLoaded']),
    },
    'uncaughtError': {
      frameId: t.String,
      message: t.String,
      stack: t.String,
    },
    'frameAttached': {
      frameId: t.String,
      parentFrameId: t.Optional(t.String),
    },
    'frameDetached': {
      frameId: t.String,
    },
    'navigationStarted': {
      frameId: t.String,
      navigationId: t.String,
      url: t.String,
    },
    'navigationCommitted': {
      frameId: t.String,
      navigationId: t.String,
      url: t.String,
      // frame.id or frame.name
      name: t.String,
    },
    'navigationAborted': {
      frameId: t.String,
      navigationId: t.String,
      errorText: t.String,
    },
    'sameDocumentNavigation': {
      frameId: t.String,
      url: t.String,
    },
    'console': {
      frameId: t.String,
      args: t.Array(types.RemoteObject),
      type: t.String,
      location: {
        columnNumber: t.Number,
        lineNumber: t.Number,
        url: t.String,
      },
    },
    'dialogOpened': {
      dialogId: t.String,
      type: t.Enum(['prompt', 'alert', 'confirm', 'beforeunload']),
      message: t.String,
      defaultValue: t.Optional(t.String),
    },
    'dialogClosed': {
      dialogId: t.String,
    },
    'bindingCalled': {
      frameId: t.String,
      name: t.String,
      payload: t.Any,
    },
  },

  methods: {
    'enable': {
      params: {},
    },
    'close': {
      params: {
        runBeforeUnload: t.Optional(t.Boolean),
      },
    },
    'setFileInputFiles': {
      params: {
        frameId: t.String,
        objectId: t.String,
        files: t.Array(t.String),
      },
    },
    'setViewport': {
      params: {
        viewport: t.Nullable({
          width: t.Number,
          height: t.Number,
          deviceScaleFactor: t.Number,
          isMobile: t.Boolean,
          hasTouch: t.Boolean,
          isLandscape: t.Boolean,
        }),
      },
    },
    'setUserAgent': {
      params: {
        userAgent: t.Nullable(t.String),
      },
    },
    'setEmulatedMedia': {
      params: {
        media: t.Enum(['screen', 'print', '']),
      },
    },
    'setCacheDisabled': {
      params: {
        cacheDisabled: t.Boolean,
      },
    },
    'setJavascriptEnabled': {
      params: {
        enabled: t.Boolean,
      },
    },
    'contentFrame': {
      params: {
        frameId: t.String,
        objectId: t.String,
      },
      returns: {
        frameId: t.Nullable(t.String),
      },
    },
    'evaluate': {
      params: t.Either({
        // Pass frameId here.
        executionContextId: t.String,
        functionText: t.String,
        returnByValue: t.Optional(t.Boolean),
        args: t.Array(t.Either(
          { objectId: t.String },
          { unserializableValue: t.Enum(['Infinity', '-Infinity', '-0', 'NaN']) },
          { value: t.Any },
        )),
      }, {
        // Pass frameId here.
        executionContextId: t.String,
        script: t.String,
        returnByValue: t.Optional(t.Boolean),
      }),

      returns: {
        result: t.Optional(types.RemoteObject),
        exceptionDetails: t.Optional({
          text: t.Optional(t.String),
          stack: t.Optional(t.String),
          value: t.Optional(t.Any),
        }),
      }
    },
    'addBinding': {
      params: {
        name: t.String,
      },
    },
    'addScriptToEvaluateOnNewDocument': {
      params: {
        script: t.String,
      },
      returns: {
        scriptId: t.String,
      }
    },
    'removeScriptToEvaluateOnNewDocument': {
      params: {
        scriptId: t.String,
      },
    },
    'disposeObject': {
      params: {
        executionContextId: t.String,
        objectId: t.String,
      },
    },

    'getObjectProperties': {
      params: {
        executionContextId: t.String,
        objectId: t.String,
      },

      returns: {
        properties: t.Array({
          name: t.String,
          value: types.RemoteObject,
        }),
      }
    },
    'navigate': {
      params: {
        frameId: t.String,
        url: t.String,
        referer: t.Optional(t.String),
      },
      returns: {
        navigationId: t.Nullable(t.String),
        navigationURL: t.Nullable(t.String),
      }
    },
    'goBack': {
      params: {
        frameId: t.String,
      },
      returns: {
        navigationId: t.Nullable(t.String),
        navigationURL: t.Nullable(t.String),
      }
    },
    'goForward': {
      params: {
        frameId: t.String,
      },
      returns: {
        navigationId: t.Nullable(t.String),
        navigationURL: t.Nullable(t.String),
      }
    },
    'reload': {
      params: {
        frameId: t.String,
      },
      returns: {
        navigationId: t.String,
        navigationURL: t.String,
      }
    },
    'getBoundingBox': {
      params: {
        frameId: t.String,
        objectId: t.String,
      },
      returns: t.Nullable({
        x: t.Number,
        y: t.Number,
        width: t.Number,
        height: t.Number,
      }),
    },
    'screenshot': {
      params: {
        mimeType: t.Enum(['image/png', 'image/jpeg']),
        fullPage: t.Optional(t.Boolean),
        clip: t.Optional({
          x: t.Number,
          y: t.Number,
          width: t.Number,
          height: t.Number,
        })
      },
      returns: {
        data: t.String,
      }
    },
    'getContentQuads': {
      params: {
        frameId: t.String,
        objectId: t.String,
      },
      returns: {
        quads: t.Array(types.DOMQuad),
      },
    },
    'dispatchKeyEvent': {
      params: {
        type: t.String,
        key: t.String,
        keyCode: t.Number,
        location: t.Number,
        code: t.String,
        repeat: t.Boolean,
      }
    },
    'dispatchMouseEvent': {
      params: {
        type: t.String,
        button: t.Number,
        x: t.Number,
        y: t.Number,
        modifiers: t.Number,
        clickCount: t.Optional(t.Number),
        buttons: t.Number,
      }
    },
    'insertText': {
      params: {
        text: t.String,
      }
    },
    'handleDialog': {
      params: {
        dialogId: t.String,
        accept: t.Boolean,
        promptText: t.Optional(t.String),
      },
    },
  },
};

this.protocol = {
  domains: {Browser, Target, Page, Network},
};
this.checkScheme = checkScheme;
this.EXPORTED_SYMBOLS = ['protocol', 'checkScheme'];
