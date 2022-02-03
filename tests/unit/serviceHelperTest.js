process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;
const serviceHelper = require("../../ZelBack/src/services/serviceHelper");
const config = require('../../ZelBack/config/default');
const chai = require('chai')
const assert = require('assert')
const log = require('../../ZelBack/src/lib/log');
const { doesNotMatch } = require("assert");
const express = require('express');
const expect = chai.expect
const addressTransactionIndexCollection = config.database.daemon.collections.addressTransactionIndex;
const localAppsInformation = config.database.appslocal.collections.appsInformation;
const globalAppsInformation = config.database.appsglobal.collections.appsInformation;
describe('serviceHelper Functions', () => {
    let mochaAsync = (fn) => {
        return (done) => {
            fn.call().then(done, (err) => { done(err) });
        };
    };
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

    // describe('initiateDB', () => {
    //     it('should ensure that DB is initiated', () => {
    //         serviceHelper.initiateDB().then((res) => {
    //             expect(res).to.equal(true)
    //         })
    //     })
    // })

    // describe('databaseConnection', () => {
    //     it('should ensure that it gets DB Connection object', () => {
    //         expect(serviceHelper.databaseConnection()).to.equal(null)
    //     })
    // })

    // describe('distinctDatabase', () => {
    //     it('should ensure that it gets DB Connection object', async ()=> {
    //         serviceHelper.initiateDB().then(() => {
    //            // console.log("hi hamid")
    //           // assert.equal(true,true)
    //         })
    //     })
    // })



    // describe('distinctDatabase', () => {
    //     let mochaAsync = (fn) => {
    //         return (done) => {
    //           fn.call().then(done, (err)=>{done(err)});
    //         };
    //       };
    //     beforeEach(mochaAsync(async () => {
    //         await serviceHelper.initiateDB();
    //     }));
       
    //       it("Sample async/await mocha test using wrapper", mochaAsync(async () => {
    //         await serviceHelper.initiateDB();
    //         var MockExpressRequest = require('mock-express-request');
    //         var MockExpressResponse = require('mock-express-response');
    //         var res = new MockExpressResponse();
    //         const dbopen = serviceHelper.databaseConnection();
    //         const database = dbopen.db(config.database.daemon.database);
    //         const variable = 'address';
    //         const results =  serviceHelper.distinctDatabase(database, addressTransactionIndexCollection, variable);
    //         const resMessage = serviceHelper.createDataMessage(results);
    //         console.log("hello",results)
    //         res.json(resMessage);
    //     }));
    // })
//////////////////////////////
    
    describe('connectMongoDb', () => {
        before(mochaAsync(async () => {
            await serviceHelper.initiateDB();
        }))
        it("should ensure that MongoDB is connected", mochaAsync(async () => {
            openDBConnection = await serviceHelper.connectMongoDb();
            expect(typeof (openDBConnection)).to.be.equal('object')
        }));
    })
    describe('distinctDatabase', () => {
        before(mochaAsync(async () => {
            await serviceHelper.initiateDB();
        }))
        it("should ensure that distinctDatabase returns success message", mochaAsync(async () => {
            try {
                const dbopen = serviceHelper.databaseConnection();
                const database = dbopen.db(config.database.daemon.database);
                const variable = 'address';
                var MockExpressResponse = require('mock-express-response');
                var res = new MockExpressResponse();
                const results = await serviceHelper.distinctDatabase(database, addressTransactionIndexCollection, variable);
                const resMessage = serviceHelper.createDataMessage(results);
               expect(resMessage.status).to.equal('success')
              } catch (error) {
                log.error(error);
                const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
                res.json(errMessage);
              }
        }));
    })

    describe('findInDatabase', () => {
        before(mochaAsync(async () => {
            await serviceHelper.initiateDB();
        }))
        it("should ensure that findInDatabase works fine", mochaAsync(async () => {
            try {
                const dbopen = serviceHelper.databaseConnection();
                const appsDatabase = dbopen.db(config.database.appslocal.database);
                const appsQuery = {};
                var MockExpressResponse = require('mock-express-response');
                var res = new MockExpressResponse();
                const appsProjection = { projection: { _id: 0 } };
                const messages = await serviceHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
                console.log("msg",messages)
              } catch (error) {
                log.error(error);
                const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
                res.json(errMessage);
              }
        }));
    })


    describe('findOneAndUpdateInDatabase', () => {
        before(mochaAsync(async () => {
            await serviceHelper.initiateDB();
        }))
        it("should ensure that findOneAndUpdateInDatabase works fine", mochaAsync(async () => {
            try {
                var MockExpressResponse = require('mock-express-response');
                var res = new MockExpressResponse();
                const dbopen = serviceHelper.databaseConnection();
                const appsDatabase = dbopen.db(config.database.appslocal.database);
                const appsQuery = {};
                const messages = await serviceHelper.findOneAndUpdateInDatabase(appsDatabase, collection, appsQuery, update, options)
              } catch (error) {
                log.error(error);
                const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
                res.json(errMessage);
              }
        }));
    })

    describe('insertOneToDatabase', () => {
        before(mochaAsync(async () => {
            await serviceHelper.initiateDB();
        }))
        it("should ensure that insertOneToDatabase works fine", mochaAsync(async () => {
            try {
                var MockExpressResponse = require('mock-express-response');
                var res = new MockExpressResponse();
                const dbopen = serviceHelper.databaseConnection();
                const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
                const sharedCollection = config.database.fluxshare.collections.shared;
                const string = file + new Date().getTime().toString() + Math.floor((Math.random() * 999999999999999)).toString();
              
                const fileDetail = {
                    name: file,
                    token: crypto.createHash('sha256').update(string).digest('hex'),
                  };
                const messages = await serviceHelper.insertOneToDatabase(databaseFluxShare, sharedCollection, fileDetail)
              } catch (error) {
                log.error(error);
                const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
                res.json(errMessage);
              }
        }));
    })

    describe('updateInDatabase', () => {
        before(mochaAsync(async () => {
            await serviceHelper.initiateDB();
        }))
        it("should ensure that updateInDatabase works fine", mochaAsync(async () => {
            try {
                const dbopen = serviceHelper.databaseConnection();
                const appsDatabase = dbopen.db(config.database.appslocal.database);
                const appsQuery = {};
                const appsProjection = { projection: { _id: 0 } };
                const messages = await serviceHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
              } catch (error) {
                log.error(error);
                const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
                res.json(errMessage);
              }
        }));
    })

    describe('updateOneInDatabase', () => {
        before(mochaAsync(async () => {
            await serviceHelper.initiateDB();
        }))
        it("should ensure that updateOneInDatabase works fine", mochaAsync(async () => {
            try {
                const dbopen = serviceHelper.databaseConnection();
                const appsDatabase = dbopen.db(config.database.appslocal.database);
                const appsQuery = {};
                const appsProjection = { projection: { _id: 0 } };
                const messages = await serviceHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
              } catch (error) {
                log.error(error);
                const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
                res.json(errMessage);
              }
        }));
    })

    describe('findOneAndDeleteInDatabase', () => {
        before(mochaAsync(async () => {
            await serviceHelper.initiateDB();
        }))
        it("should ensure that findOneAndDeleteInDatabase works fine", mochaAsync(async () => {
            try {
                const dbopen = serviceHelper.databaseConnection();
                var MockExpressResponse = require('mock-express-response');
                var res = new MockExpressResponse();
                const databaseApps = dbopen.db(config.database.appsglobal.database);
                const projectionApps = { projection: { _id: 0, name: 1, hash: 1 } };
                const query={}
                const messages = await serviceHelper.findOneAndDeleteInDatabase(databaseApps, collection, query, projection)
              } catch (error) {
                log.error(error);
                const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
                res.json(errMessage);
              }
        }));
    })

    describe('removeDocumentsFromCollection', () => {
        before(mochaAsync(async () => {
            await serviceHelper.initiateDB();
        }))
        it("should ensure that removeDocumentsFromCollection works fine", mochaAsync(async () => {
            try {
                const dbopen = serviceHelper.databaseConnection();
                const database = dbopen.db(config.database.local.database);
                const collection = config.database.local.collections.loggedUsers;
                const query={}
                const messages = await serviceHelper.removeDocumentsFromCollection(database, collection, query)
              } catch (error) {
                log.error(error);
                const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
                res.json(errMessage);
              }
        }));
    })
})