// Mock for @kubernetes/client-node - CommonJS format
class KubeConfig {
  constructor() {
    this.clusters = [];
    this.users = [];
    this.contexts = [];
    this.currentContext = '';
  }

  loadFromDefault() {}
  loadFromString(config) {}
  loadFromFile(file) {}
  makeApiClient(apiClientType) {
    return {};
  }
}

class CoreV1Api {
  constructor() {}
  listNamespacedPod() {
    return Promise.resolve({ body: { items: [] } });
  }
  createNamespacedPod() {
    return Promise.resolve({ body: {} });
  }
  deleteNamespacedPod() {
    return Promise.resolve({ body: {} });
  }
}

class AppsV1Api {
  constructor() {}
  listNamespacedDeployment() {
    return Promise.resolve({ body: { items: [] } });
  }
}

class BatchV1Api {
  constructor() {}
  listNamespacedJob() {
    return Promise.resolve({ body: { items: [] } });
  }
}

module.exports = {
  KubeConfig,
  CoreV1Api,
  AppsV1Api,
  BatchV1Api,
};
