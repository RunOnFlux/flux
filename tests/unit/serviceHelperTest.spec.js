process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;
const chai = require('chai');
const expect = chai.expect;
const serviceHelper = require("../../ZelBack/src/services/serviceHelper");
describe('serviceHelper tests', () => {
  describe('ensureBoolean function tests', () => {
    const falseBools = ['false', false, 0, '0'];
    const trueBools = ['true', true, 1, '1'];
    const restOfTruthyValues = [3, 3n, 'test', [1, 2], { name: 'testobject' }];
    const restOfFalsyValues = [0n, null, undefined, NaN, ''];

    for (let falseBool of falseBools) {
      it(`parameter ${typeof falseBool === 'string' ? `"${falseBool}"` : falseBool} should return false`, () => {
        expect(serviceHelper.ensureBoolean(falseBool)).to.equal(false);
      });
    }
    for (let trueBool of trueBools) {
      it(`parameter ${typeof trueBool === 'string' ? `"${trueBool}"` : trueBool} should return false`, () => {
        expect(serviceHelper.ensureBoolean(trueBool)).to.equal(true);
      });
    }
    for (let truthyValue of restOfTruthyValues) {
      it(`parameter ${typeof truthyValue === 'string' ? `"${truthyValue}"` : truthyValue} should return undefined`, () => {
        expect(serviceHelper.ensureBoolean(truthyValue)).to.be.undefined;
      });
    }
    for (let falsyValue of restOfFalsyValues) {
      it(`parameter ${typeof falsyValue === 'string' ? `"${falsyValue}"` : falsyValue} should return undefined`, () => {
        expect(serviceHelper.ensureBoolean(falsyValue)).to.be.undefined;
      });
    }
    it('empty parameter should return undefined', () => {
      expect(serviceHelper.ensureBoolean()).to.be.undefined;
    });
  });

  describe('ensureNumber function tests', () => {
    it('parameter 1 should return 1', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber(1);
      const expected = 1;

      expect(ensureNumberOutput).to.equal(expected)
      expect(ensureNumberOutput).to.be.a('number')
    });
    it('parameter "1" should return 1', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber("1");
      const expected = 1;

      expect(ensureNumberOutput).to.equal(expected)
      expect(ensureNumberOutput).to.be.a('number')
    });
    it('parameter "2.5" should return 2.5', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber("2.5");
      const expected = 2.5;

      expect(ensureNumberOutput).to.equal(expected)
      expect(ensureNumberOutput).to.be.a('number')
    });
    it('parameter 2.5 should return 2.5', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber(2.5);
      const expected = 2.5;

      expect(ensureNumberOutput).to.equal(expected)
      expect(ensureNumberOutput).to.be.a('number')
    });
    it('parameter "test" should return NaN', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber("test");

      expect(ensureNumberOutput).to.be.NaN
    });
    it('parameter {name: 1} should return NaN', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber({ name: 1 });

      expect(ensureNumberOutput).to.be.NaN
    });
  });

  describe('ensureObject tests', () => {
    it('parameter of type object should return the same object', () => {
      const testObject = {
        id: 1,
        username: 'Testing user'
      }

      const ensureObjectOutput = serviceHelper.ensureObject(testObject);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.equal(testObject);
    });

    it('empty parameter should return an empty object', () => {
      const ensureObjectOutput = serviceHelper.ensureObject();

      expect(ensureObjectOutput).to.be.an('object').that.is.empty;
    });

    it('parameter of type json string should return an object', () => {
      const stringObject = '{"id": 1,"username": "Testing user"}';
      const expected = {
        id: 1,
        username: 'Testing user'
      }

      const ensureObjectOutput = serviceHelper.ensureObject(stringObject);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.eql(expected);
    });

    it('parameter of type query string should return an object', () => {
      const queryString = 'username=Tester&id=1';
      const expected = {
        id: '1',
        username: 'Tester'
      }

      const ensureObjectOutput = serviceHelper.ensureObject(queryString);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.eql(expected);
    });

    it('parameter of type string should return an object', () => {
      const testString = 'test';
      const expected = {
        test: "",
      }

      const ensureObjectOutput = serviceHelper.ensureObject(testString);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.eql(expected);
    });

    it('parameter of type array should return an array', () => {
      const testArr = ['1', 'testing', 3];

      const ensureObjectOutput = serviceHelper.ensureObject(testArr);

      expect(ensureObjectOutput).to.be.an('array');
      expect(ensureObjectOutput).to.eql(testArr);
    });

    const otherTypes = [1, true]
    for (let param of otherTypes) {
      it(`parameter of type ${typeof param} should return undefined`, () => {
        expect(serviceHelper.ensureObject(param)).to.be.an('object').that.is.empty;
      });
    }
  });

  describe('ensureString tests', () => {
    it('parameter of type string should return a string', () => {
      const testString = 'testing string';

      const ensureStringOutput = serviceHelper.ensureString(testString);

      expect(ensureStringOutput).to.be.a('string');
      expect(ensureStringOutput).to.eql(testString);
    });

  });

});

