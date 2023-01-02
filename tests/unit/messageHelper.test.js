import chai from 'chai';

const { expect } = chai;

import messageHelper from '../../ZelBack/src/services/messageHelper.js';
messageHelper.default;

describe('messageHelper tests', () => {
  describe('createDataMessage tests', () => {
    it('should return a proper data message when called correctly', () => {
      const testData = { id: 55, message: 'this is my test message' };

      const { status, data } = messageHelper.createDataMessage(testData);

      expect(status).to.equal('success');
      expect(data).to.equal(testData);
    });
  });

  describe('createSuccessMessage tests', () => {
    it('should return a proper data message when called correctly', () => {
      const code = 200;
      const name = 'Successful transfer';
      const message = 'Your funds were transfered properly!';

      const { status, data } = messageHelper.createSuccessMessage(message, name, code);

      expect(status).to.equal('success');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });
  });

  describe('createSuccessMessage tests', () => {
    it('should return a proper success message when called with all parameters', () => {
      const code = 200;
      const name = 'Successful transfer';
      const message = 'Your funds were transfered properly!';

      const { status, data } = messageHelper.createSuccessMessage(message, name, code);

      expect(status).to.equal('success');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });

    it('should return a proper success message when called with empty message', () => {
      const code = 200;
      const name = 'Successful transfer';
      const message = '';

      const { status, data } = messageHelper.createSuccessMessage(message, name, code);

      expect(status).to.equal('success');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });
  });

  describe('createWarningMessage tests', () => {
    it('should return a proper warning message when called with all parameters', () => {
      const code = 214;
      const name = 'Warning!';
      const message = 'There was a slight issue!';

      const { status, data } = messageHelper.createWarningMessage(message, name, code);

      expect(status).to.equal('warning');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });

    it('should return a proper warning message when called with empty message', () => {
      const code = 214;
      const name = 'Warning!';
      const message = '';

      const { status, data } = messageHelper.createWarningMessage(message, name, code);

      expect(status).to.equal('warning');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });
  });

  describe('createErrorMessage tests', () => {
    it('should return a proper error message when called with all parameters', () => {
      const code = 503;
      const name = 'Error happened!!';
      const message = 'There was a big error!';

      const { status, data } = messageHelper.createErrorMessage(message, name, code);

      expect(status).to.equal('error');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });

    it('should return a proper error message when called with empty message', () => {
      const code = 503;
      const name = 'Error happened!!';
      const message = '';
      const expectedMessage = 'Unknown error';

      const { status, data } = messageHelper.createErrorMessage(message, name, code);

      expect(status).to.equal('error');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(expectedMessage);
    });
  });

  describe('errUnauthorizedMessage tests', () => {
    it('should return a proper unauthorized message when called', () => {
      const code = 401;
      const name = 'Unauthorized';
      const message = 'Unauthorized. Access denied.';

      const { status, data } = messageHelper.errUnauthorizedMessage(message, name, code);

      expect(status).to.equal('error');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });
  });
});
