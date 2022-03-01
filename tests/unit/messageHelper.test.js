const chai = require('chai');

const { expect } = chai;

const messageHelper = require('../../ZelBack/src/services/messageHelper');

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

  describe('verifyMessage tests', () => {
    const message = 'test';
    const publicKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const validSignature = 'G6wvdaMqtuQYqa5BAtKsLHFCYQwB4PXoTwG0YSGtWU6ude/brDNM5MraSBfT64HU3XPhObGohFjLLo6KjtMgnlc=';
    const address = '1KoXq8mLxpNt3BSnNLq2HzKC39Ne2pVJtF';

    it('should return true if message is signed properly with a public key', () => {
      const verification = messageHelper.verifyMessage(message, publicKey, validSignature);
      expect(verification).to.be.true;
    });

    it('should return true if message is signed properly with an address', () => {
      const verification = messageHelper.verifyMessage(message, address, validSignature);
      expect(verification).to.be.true;
    });

    it('should return error if the address is invalid', () => {
      const verification = messageHelper.verifyMessage(message, '12355', validSignature);
      expect(verification).to.be.an('error');
    });

    it('should return false if the publicKey is invalid', () => {
      const verification = messageHelper.verifyMessage(message, '0474eb4690689bb408139249eda7f361b7881c4254ccbe30', validSignature);
      expect(verification).to.be.false;
    });

    it('should return error if there is no signature', () => {
      const verification = messageHelper.verifyMessage(message, address);
      expect(verification).to.be.an('error');
    });

    it('should return false if the address is wrong', () => {
      const verification = messageHelper.verifyMessage(message, '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', validSignature);
      expect(verification).to.be.false;
    });

    it('should return error if the signature is invalid', () => {
      const verification = messageHelper.verifyMessage(message, address, '1234567ASDFG');
      expect(verification).to.be.an('error');
    });
  });
});
