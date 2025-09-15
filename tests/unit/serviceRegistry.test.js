const { expect } = require('chai');
const serviceRegistry = require('../../ZelBack/src/services/serviceRegistry');

describe('Service Registry Tests', () => {
  afterEach(() => {
    // Clear registry after each test
    serviceRegistry.clear();
  });

  describe('register and get', () => {
    it('should register and retrieve a service', () => {
      const mockService = { name: 'testService', method: () => 'test' };
      serviceRegistry.register('testService', mockService);

      const retrieved = serviceRegistry.get('testService');
      expect(retrieved).to.equal(mockService);
      expect(retrieved.method()).to.equal('test');
    });

    it('should throw error when getting non-existent service', () => {
      expect(() => serviceRegistry.get('nonExistent')).to.throw('Service \'nonExistent\' not found in registry');
    });
  });

  describe('registerLazy and get', () => {
    it('should lazy load a service on first get', () => {
      let loadCount = 0;
      const mockService = { name: 'lazyService' };

      serviceRegistry.registerLazy('lazyService', () => {
        loadCount += 1;
        return mockService;
      });

      // Service not loaded yet
      expect(loadCount).to.equal(0);

      // First get triggers load
      const retrieved1 = serviceRegistry.get('lazyService');
      expect(loadCount).to.equal(1);
      expect(retrieved1).to.equal(mockService);

      // Second get uses cached version
      const retrieved2 = serviceRegistry.get('lazyService');
      expect(loadCount).to.equal(1); // Still 1, not loaded again
      expect(retrieved2).to.equal(mockService);
    });
  });

  describe('has', () => {
    it('should return true for registered services', () => {
      serviceRegistry.register('testService', {});
      expect(serviceRegistry.has('testService')).to.be.true;
    });

    it('should return true for lazy-registered services', () => {
      serviceRegistry.registerLazy('lazyService', () => ({}));
      expect(serviceRegistry.has('lazyService')).to.be.true;
    });

    it('should return false for non-existent services', () => {
      expect(serviceRegistry.has('nonExistent')).to.be.false;
    });
  });

  describe('clear', () => {
    it('should clear all registered services', () => {
      serviceRegistry.register('service1', {});
      serviceRegistry.registerLazy('service2', () => ({}));

      expect(serviceRegistry.has('service1')).to.be.true;
      expect(serviceRegistry.has('service2')).to.be.true;

      serviceRegistry.clear();

      expect(serviceRegistry.has('service1')).to.be.false;
      expect(serviceRegistry.has('service2')).to.be.false;
    });
  });
});