// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const constants = require('../../ZelBack/src/services/appMonitoring/syncthingMonitorConstants');

describe('syncthingMonitorConstants tests', () => {
  describe('Timeout constants', () => {
    it('should have DEVICE_ID_REQUEST_TIMEOUT_MS defined', () => {
      expect(constants.DEVICE_ID_REQUEST_TIMEOUT_MS).to.be.a('number');
      expect(constants.DEVICE_ID_REQUEST_TIMEOUT_MS).to.equal(5000);
    });

    it('should have MONITOR_INTERVAL_MS defined', () => {
      expect(constants.MONITOR_INTERVAL_MS).to.be.a('number');
      expect(constants.MONITOR_INTERVAL_MS).to.equal(30000);
    });

    it('should have OPERATION_DELAY_MS defined', () => {
      expect(constants.OPERATION_DELAY_MS).to.be.a('number');
      expect(constants.OPERATION_DELAY_MS).to.equal(500);
    });

    it('should have ERROR_RETRY_DELAY_MS defined', () => {
      expect(constants.ERROR_RETRY_DELAY_MS).to.be.a('number');
      expect(constants.ERROR_RETRY_DELAY_MS).to.equal(5000);
    });
  });

  describe('Syncthing configuration constants', () => {
    it('should have SYNCTHING_RESCAN_INTERVAL_SECONDS defined', () => {
      expect(constants.SYNCTHING_RESCAN_INTERVAL_SECONDS).to.be.a('number');
      expect(constants.SYNCTHING_RESCAN_INTERVAL_SECONDS).to.equal(900);
    });

    it('should have SYNCTHING_MAX_CONFLICTS defined', () => {
      expect(constants.SYNCTHING_MAX_CONFLICTS).to.be.a('number');
      expect(constants.SYNCTHING_MAX_CONFLICTS).to.equal(0);
    });
  });

  describe('Sync monitoring constants', () => {
    it('should have MAX_SYNC_WAIT_EXECUTIONS defined', () => {
      expect(constants.MAX_SYNC_WAIT_EXECUTIONS).to.be.a('number');
      expect(constants.MAX_SYNC_WAIT_EXECUTIONS).to.equal(60);
    });

    it('should have CLOCK_SKEW_TOLERANCE_MS defined', () => {
      expect(constants.CLOCK_SKEW_TOLERANCE_MS).to.be.a('number');
      expect(constants.CLOCK_SKEW_TOLERANCE_MS).to.equal(5000);
    });

    it('should have LEADER_ELECTION_MIN_EXECUTIONS defined', () => {
      expect(constants.LEADER_ELECTION_MIN_EXECUTIONS).to.be.a('number');
      expect(constants.LEADER_ELECTION_MIN_EXECUTIONS).to.equal(2);
    });

    it('should have LEADER_ELECTION_EXECUTIONS_PER_INDEX defined', () => {
      expect(constants.LEADER_ELECTION_EXECUTIONS_PER_INDEX).to.be.a('number');
      expect(constants.LEADER_ELECTION_EXECUTIONS_PER_INDEX).to.equal(10);
    });

    it('should have SYNC_COMPLETE_PERCENTAGE defined', () => {
      expect(constants.SYNC_COMPLETE_PERCENTAGE).to.be.a('number');
      expect(constants.SYNC_COMPLETE_PERCENTAGE).to.equal(100);
    });
  });

  describe('Constants relationships', () => {
    it('should have monitor interval greater than operation delay', () => {
      expect(constants.MONITOR_INTERVAL_MS).to.be.greaterThan(constants.OPERATION_DELAY_MS);
    });

    it('should have error retry delay greater than operation delay', () => {
      expect(constants.ERROR_RETRY_DELAY_MS).to.be.greaterThan(constants.OPERATION_DELAY_MS);
    });

    it('should have reasonable max wait executions', () => {
      expect(constants.MAX_SYNC_WAIT_EXECUTIONS).to.be.greaterThan(0);
      expect(constants.MAX_SYNC_WAIT_EXECUTIONS).to.be.lessThan(1000);
    });
  });
});
