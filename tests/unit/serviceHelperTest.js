process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;
const serviceHelper = require("../../ZelBack/src/services/serviceHelper");
const config = require('../../ZelBack/config/default');
const chai = require('chai')
const assert = require('assert')
const expect = chai.expect
const addressTransactionIndexCollection = config.database.daemon.collections.addressTransactionIndex;
const localAppsInformation = config.database.appslocal.collections.appsInformation;

describe('serviceHelper Functions', () => {
    describe('ensureBoolean', () => {
        it('should ensure that parameter is boolean', () => {
            expect(serviceHelper.ensureBoolean('false')).to.equal(false)
            expect(serviceHelper.ensureBoolean(false)).to.equal(false)
            expect(serviceHelper.ensureBoolean('0')).to.equal(false)
            expect(serviceHelper.ensureBoolean(0)).to.equal(false)

            expect(serviceHelper.ensureBoolean('true')).to.equal(true)
            expect(serviceHelper.ensureBoolean(true)).to.equal(true)
            expect(serviceHelper.ensureBoolean('1')).to.equal(true)
            expect(serviceHelper.ensureBoolean(1)).to.equal(true)
        })
    })

    describe('ensureNumber', () => {
        it('should ensure that parameter is a Number', () => {
            expect(serviceHelper.ensureNumber(2)).to.equal(2)
            expect(serviceHelper.ensureNumber('2')).to.equal(2)
        })
    })

    describe('ensureObject', () => {
        it('should ensure that parameter is an Object', () => {
            let obj = { name: "test" }
            expect(serviceHelper.ensureObject(obj)).to.equal(obj)
        })
    })

    describe('ensureString', () => {
        it('should ensure that parameter is a String', () => {
            expect(serviceHelper.ensureString("test")).to.equal("test")
        })
        it('should ensure that parameter is a String', () => {
            expect(serviceHelper.ensureString(123)).to.equal("123")
        })
    })

    describe('createDataMessage', () => {
        it('should ensure that Data message is created', () => {
            assert.deepEqual(serviceHelper.createDataMessage("TestingString"), { status: 'success', data: "TestingString" })
        })
    })

    describe('createSuccessMessage', () => {
        it('should ensure that Success message is created', () => {
            assert.deepEqual(serviceHelper.createSuccessMessage("Success Message", "Temp Name", "200"), {
                status: 'success',
                data: {
                    code: "200",
                    name: "Temp Name",
                    message: "Success Message"
                },
            })
        })
    })

    describe('createWarningMessage', () => {
        it('should ensure that Warning message is created', () => {
            assert.deepEqual(serviceHelper.createWarningMessage("Warning Message", "Temp Name", "199"), {
                status: 'warning',
                data: {
                    code: "199",
                    name: "Temp Name",
                    message: "Warning Message"
                },
            })
        })
    })
    describe('createErrorMessage', () => {
        it('should ensure that Error message is created', () => {
            assert.deepEqual(serviceHelper.createErrorMessage("Error Message", "Temp Name", "404"), {
                status: 'error', data: { code: "404", name: "Temp Name", message: "Error Message" },
            })
        })
        it('should ensure that Error message is created when no message is passed ', () => {
            assert.deepEqual(serviceHelper.createErrorMessage("", "Temp Name", "404"), {
                status: 'error', data: { code: "404", name: "Temp Name", message: "Unknown error" },
            })
        })
    })

    describe('errUnauthorizedMessage', () => {
        it('should ensure that Error message is created', () => {
            assert.deepEqual(serviceHelper.errUnauthorizedMessage(), {
                status: 'error', data: { code: 401, name: 'Unauthorized', message: 'Unauthorized. Access denied.', },
            })
        })
    })

    describe('initiateDB', () => {
        it('should ensure that DB is initiated', () => {
            serviceHelper.initiateDB().then((res) => {
                expect(res).to.equal(true)
            })
        })
    })

    describe('databaseConnection', () => {
        it('should ensure that it gets DB Connection object', () => {
            expect(serviceHelper.databaseConnection()).to.equal(null)
        })
    })

})