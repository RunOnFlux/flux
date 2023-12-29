"use strict";(globalThis["webpackChunkflux"]=globalThis["webpackChunkflux"]||[]).push([[6585],{40924:(e,t,a)=>{a.d(t,{Z:()=>h});var r=function(){var e=this,t=e.$createElement,a=e._self._c||t;return a("b-popover",{ref:"popover",attrs:{target:""+e.target,triggers:"click blur",show:e.show,placement:"auto",container:"my-container","custom-class":"confirm-dialog-"+e.width},on:{"update:show":function(t){e.show=t}},scopedSlots:e._u([{key:"title",fn:function(){return[a("div",{staticClass:"d-flex justify-content-between align-items-center"},[a("span",[e._v(e._s(e.title))]),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"close",attrs:{variant:"transparent","aria-label":"Close"},on:{click:function(t){e.show=!1}}},[a("span",{staticClass:"d-inline-block text-white",attrs:{"aria-hidden":"true"}},[e._v("×")])])],1)]},proxy:!0}])},[a("div",{staticClass:"text-center"},[a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mr-1",attrs:{size:"sm",variant:"danger"},on:{click:function(t){e.show=!1}}},[e._v(" "+e._s(e.cancelButton)+" ")]),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],attrs:{size:"sm",variant:"primary"},on:{click:function(t){return e.confirm()}}},[e._v(" "+e._s(e.confirmButton)+" ")])],1)])},s=[],n=a(15193),o=a(72417),i=a(20266);const c={components:{BButton:n.T,BPopover:o.x},directives:{Ripple:i.Z},props:{target:{type:String,required:!0},title:{type:String,required:!1,default:"Are You Sure?"},cancelButton:{type:String,required:!1,default:"Cancel"},confirmButton:{type:String,required:!0},width:{type:Number,required:!1,default:300}},data(){return{show:!1}},methods:{confirm(){this.show=!1,this.$emit("confirm")}}},l=c;var u=a(1001),d=(0,u.Z)(l,r,s,!1,null,null,null);const h=d.exports},15774:(e,t,a)=>{a.r(t),a.d(t,{default:()=>Z});var r=function(){var e=this,t=e.$createElement,a=e._self._c||t;return a("div",[a("b-row",{staticClass:"match-height"},[a("b-col",{attrs:{sm:"12",lg:"6",xl:"4"}},[a("b-card",{attrs:{title:"Benchmark"}},[a("b-card-text",{staticClass:"mb-3"},[e._v(" An easy way to update your Benchmark daemon to the latest version. Benchmark will be automatically started once update is done. ")]),a("div",{staticClass:"text-center"},[a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],attrs:{id:"update-benchmark",variant:"success","aria-label":"Update Benchmark"}},[e._v(" Update Benchmark ")]),a("confirm-dialog",{attrs:{target:"update-benchmark","confirm-button":"Update Benchmark"},on:{confirm:function(t){return e.updateBenchmark()}}})],1)],1)],1),a("b-col",{attrs:{sm:"12",lg:"6",xl:"4"}},[a("b-card",{attrs:{title:"Manage Process"}},[a("b-card-text",{staticClass:"mb-3"},[e._v(" Here you can manage your Benchmark daemon process. ")]),a("div",{staticClass:"text-center"},[a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mx-1 mb-1",attrs:{id:"start-benchmark",variant:"success","aria-label":"Start Benchmark"}},[e._v(" Start Benchmark ")]),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mx-1 mb-1",attrs:{id:"stop-benchmark",variant:"success","aria-label":"Stop Benchmark"}},[e._v(" Stop Benchmark ")]),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mx-1 mb-1",attrs:{id:"restart-benchmark",variant:"success","aria-label":"Restart Benchmakr"}},[e._v(" Restart Benchmark ")]),a("confirm-dialog",{attrs:{target:"start-benchmark","confirm-button":"Start Benchmark"},on:{confirm:function(t){return e.startBenchmark()}}}),a("confirm-dialog",{attrs:{target:"stop-benchmark","confirm-button":"Stop Benchmark"},on:{confirm:function(t){return e.stopBenchmark()}}}),a("confirm-dialog",{attrs:{target:"restart-benchmark","confirm-button":"Restart Benchmark"},on:{confirm:function(t){return e.restartBenchmark()}}})],1)],1)],1),a("b-col",{attrs:{sm:"12",xl:"4"}},[a("b-card",{attrs:{title:"Restart"}},[a("b-card-text",{staticClass:"mb-2"},[e._v(" Option to trigger a complete new run of node benchmarking. Useful when your node falls down in category or fails benchmarking tests. ")]),a("div",{staticClass:"text-center"},[a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],attrs:{id:"restart-benchmarks",variant:"success","aria-label":"Restart Benchmarks"}},[e._v(" Restart Benchmarks ")]),a("confirm-dialog",{attrs:{target:"restart-benchmarks","confirm-button":"Restart Benchmarks"},on:{confirm:function(t){return e.restartBenchmarks()}}})],1)],1)],1)],1)],1)},s=[],n=a(23215),o=a(26253),i=a(50725),c=a(64206),l=a(15193),u=a(3899),d=a(20266),h=a(9669),m=a.n(h),g=a(40924),p=a(39055),b=a(39569);const f=a(80129),k={components:{BCard:n._,BRow:o.T,BCol:i.l,BCardText:c.j,BButton:l.T,ConfirmDialog:g.Z,ToastificationContent:u.Z},directives:{Ripple:d.Z},mounted(){this.checkBenchmarkVersion()},methods:{checkBenchmarkVersion(){b.Z.getInfo().then((e=>{console.log(e);const t=e.data.data.version;m().get("https://raw.githubusercontent.com/runonflux/flux/master/helpers/benchmarkinfo.json").then((e=>{console.log(e),e.data.version!==t?this.showToast("warning","Benchmark requires an update!"):this.showToast("success","Benchmark is up to date")})).catch((e=>{console.log(e),this.showToast("danger","Error verifying recent version")}))})).catch((e=>{console.log(e),this.showToast("danger","Error connecting to benchmark")}))},updateBenchmark(){b.Z.getInfo().then((e=>{console.log(e);const t=e.data.data.version;m().get("https://raw.githubusercontent.com/runonflux/flux/master/helpers/benchmarkinfo.json").then((e=>{if(console.log(e),e.data.version!==t){const e=localStorage.getItem("zelidauth"),t=f.parse(e);console.log(t),this.showToast("success","Benchmark is now updating in the background"),p.Z.updateBenchmark(e).then((e=>{console.log(e),"error"===e.data.status&&this.showToast("danger",e.data.data.message||e.data.data)})).catch((e=>{console.log(e),console.log(e.code),this.showToast("danger",e.toString())}))}else this.showToast("success","Benchmark is already up to date")})).catch((e=>{console.log(e),this.showToast("danger","Error verifying recent version")}))})).catch((e=>{console.log(e),this.showToast("danger","Error connecting to benchmark")}))},startBenchmark(){this.showToast("warning","Benchmark will start");const e=localStorage.getItem("zelidauth");b.Z.start(e).then((e=>{"error"===e.data.status?this.showToast("danger",e.data.data.message||e.data.data):this.showToast("success",e.data.data.message||e.data.data)})).catch((e=>{console.log(e),this.showToast("danger","Error while trying to start benchmark")}))},stopBenchmark(){this.showToast("warning","Benchmark will be stopped");const e=localStorage.getItem("zelidauth");b.Z.stop(e).then((e=>{"error"===e.data.status?this.showToast("danger",e.data.data.message||e.data.data):this.showToast("success",e.data.data.message||e.data.data)})).catch((e=>{console.log(e),this.showToast("danger","Error while trying to stop benchmark")}))},restartBenchmark(){this.showToast("warning","Benchmark will now restart");const e=localStorage.getItem("zelidauth");b.Z.restart(e).then((e=>{"error"===e.data.status?this.showToast("danger",e.data.data.message||e.data.data):this.showToast("success",e.data.data.message||e.data.data)})).catch((e=>{console.log(e),this.showToast("danger","Error while trying to restart benchmark")}))},restartBenchmarks(){this.showToast("warning","Initiating new benchmarks");const e=localStorage.getItem("zelidauth");b.Z.restartNodeBenchmarks(e).then((e=>{console.log(e),"error"===e.data.status?this.showToast("danger",e.data.data.message||e.data.data):this.showToast("success",e.data.data.message||e.data.data)})).catch((e=>{console.log(e),this.showToast("danger","Error while trying to run new benchmarks")}))},showToast(e,t,a="InfoIcon"){this.$toast({component:u.Z,props:{title:t,icon:a,variant:e}})}}},x=k;var v=a(1001),w=(0,v.Z)(x,r,s,!1,null,null,null);const Z=w.exports},39569:(e,t,a)=>{a.d(t,{Z:()=>s});var r=a(80914);const s={start(e){return(0,r.Z)().get("/benchmark/start",{headers:{zelidauth:e}})},restart(e){return(0,r.Z)().get("/benchmark/restart",{headers:{zelidauth:e}})},getStatus(){return(0,r.Z)().get("/benchmark/getstatus")},restartNodeBenchmarks(e){return(0,r.Z)().get("/benchmark/restartnodebenchmarks",{headers:{zelidauth:e}})},signFluxTransaction(e,t){return(0,r.Z)().get(`/benchmark/signzelnodetransaction/${t}`,{headers:{zelidauth:e}})},helpSpecific(e){return(0,r.Z)().get(`/benchmark/help/${e}`)},help(){return(0,r.Z)().get("/benchmark/help")},stop(e){return(0,r.Z)().get("/benchmark/stop",{headers:{zelidauth:e}})},getBenchmarks(){return(0,r.Z)().get("/benchmark/getbenchmarks")},getInfo(){return(0,r.Z)().get("/benchmark/getinfo")},tailBenchmarkDebug(e){return(0,r.Z)().get("/flux/tailbenchmarkdebug",{headers:{zelidauth:e}})},justAPI(){return(0,r.Z)()},cancelToken(){return r.S}}},39055:(e,t,a)=>{a.d(t,{Z:()=>s});var r=a(80914);const s={softUpdateFlux(e){return(0,r.Z)().get("/flux/softupdateflux",{headers:{zelidauth:e}})},softUpdateInstallFlux(e){return(0,r.Z)().get("/flux/softupdatefluxinstall",{headers:{zelidauth:e}})},updateFlux(e){return(0,r.Z)().get("/flux/updateflux",{headers:{zelidauth:e}})},hardUpdateFlux(e){return(0,r.Z)().get("/flux/hardupdateflux",{headers:{zelidauth:e}})},rebuildHome(e){return(0,r.Z)().get("/flux/rebuildhome",{headers:{zelidauth:e}})},updateDaemon(e){return(0,r.Z)().get("/flux/updatedaemon",{headers:{zelidauth:e}})},reindexDaemon(e){return(0,r.Z)().get("/flux/reindexdaemon",{headers:{zelidauth:e}})},updateBenchmark(e){return(0,r.Z)().get("/flux/updatebenchmark",{headers:{zelidauth:e}})},getFluxVersion(){return(0,r.Z)().get("/flux/version")},broadcastMessage(e,t){const a=t,s={headers:{zelidauth:e}};return(0,r.Z)().post("/flux/broadcastmessage",JSON.stringify(a),s)},connectedPeers(){return(0,r.Z)().get(`/flux/connectedpeers?timestamp=${(new Date).getTime()}`)},connectedPeersInfo(){return(0,r.Z)().get(`/flux/connectedpeersinfo?timestamp=${(new Date).getTime()}`)},incomingConnections(){return(0,r.Z)().get(`/flux/incomingconnections?timestamp=${(new Date).getTime()}`)},incomingConnectionsInfo(){return(0,r.Z)().get(`/flux/incomingconnectionsinfo?timestamp=${(new Date).getTime()}`)},addPeer(e,t){return(0,r.Z)().get(`/flux/addpeer/${t}`,{headers:{zelidauth:e}})},removePeer(e,t){return(0,r.Z)().get(`/flux/removepeer/${t}`,{headers:{zelidauth:e}})},removeIncomingPeer(e,t){return(0,r.Z)().get(`/flux/removeincomingpeer/${t}`,{headers:{zelidauth:e}})},adjustCruxID(e,t){return(0,r.Z)().get(`/flux/adjustcruxid/${t}`,{headers:{zelidauth:e}})},adjustKadena(e,t,a){return(0,r.Z)().get(`/flux/adjustkadena/${t}/${a}`,{headers:{zelidauth:e}})},adjustRouterIP(e,t){return(0,r.Z)().get(`/flux/adjustrouterip/${t}`,{headers:{zelidauth:e}})},adjustBlockedPorts(e,t){const a={blockedPorts:t},s={headers:{zelidauth:e}};return(0,r.Z)().post("/flux/adjustblockedports",JSON.stringify(a),s)},adjustAPIPort(e,t){return(0,r.Z)().get(`/flux/adjustapiport/${t}`,{headers:{zelidauth:e}})},adjustBlockedRepositories(e,t){const a={blockedRepositories:t},s={headers:{zelidauth:e}};return(0,r.Z)().post("/flux/adjustblockedrepositories",JSON.stringify(a),s)},getCruxID(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/cruxid",e)},getKadenaAccount(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/kadena",e)},getRouterIP(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/routerip",e)},getBlockedPorts(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/blockedports",e)},getAPIPort(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/apiport",e)},getBlockedRepositories(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/blockedrepositories",e)},getMarketPlaceURL(){return(0,r.Z)().get("/flux/marketplaceurl")},getZelid(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/zelid",e)},getStaticIpInfo(){return(0,r.Z)().get("/flux/staticip")},restartFluxOS(e){const t={headers:{zelidauth:e,"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/restart",t)},tailFluxLog(e,t){return(0,r.Z)().get(`/flux/tail${e}log`,{headers:{zelidauth:t}})},justAPI(){return(0,r.Z)()},cancelToken(){return r.S}}}}]);