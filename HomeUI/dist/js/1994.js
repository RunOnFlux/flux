"use strict";(globalThis["webpackChunkflux"]=globalThis["webpackChunkflux"]||[]).push([[1994],{34547:(t,e,a)=>{a.d(e,{Z:()=>u});var r=function(){var t=this,e=t._self._c;return e("div",{staticClass:"toastification"},[e("div",{staticClass:"d-flex align-items-start"},[e("b-avatar",{staticClass:"mr-75 flex-shrink-0",attrs:{variant:t.variant,size:"1.8rem"}},[e("feather-icon",{attrs:{icon:t.icon,size:"15"}})],1),e("div",{staticClass:"d-flex flex-grow-1"},[e("div",[t.title?e("h5",{staticClass:"mb-0 font-weight-bolder toastification-title",class:`text-${t.variant}`,domProps:{textContent:t._s(t.title)}}):t._e(),t.text?e("small",{staticClass:"d-inline-block text-body",domProps:{textContent:t._s(t.text)}}):t._e()]),e("span",{staticClass:"cursor-pointer toastification-close-icon ml-auto",on:{click:function(e){return t.$emit("close-toast")}}},[t.hideClose?t._e():e("feather-icon",{staticClass:"text-body",attrs:{icon:"XIcon"}})],1)])],1)])},s=[],n=a(47389);const o={components:{BAvatar:n.SH},props:{variant:{type:String,default:"primary"},icon:{type:String,default:null},title:{type:String,default:null},text:{type:String,default:null},hideClose:{type:Boolean,default:!1}}},i=o;var c=a(1001),l=(0,c.Z)(i,r,s,!1,null,"22d964ca",null);const u=l.exports},87156:(t,e,a)=>{a.d(e,{Z:()=>h});var r=function(){var t=this,e=t._self._c;return e("b-popover",{ref:"popover",attrs:{target:`${t.target}`,triggers:"click blur",show:t.show,placement:"auto",container:"my-container","custom-class":`confirm-dialog-${t.width}`},on:{"update:show":function(e){t.show=e}},scopedSlots:t._u([{key:"title",fn:function(){return[e("div",{staticClass:"d-flex justify-content-between align-items-center"},[e("span",[t._v(t._s(t.title))]),e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"close",attrs:{variant:"transparent","aria-label":"Close"},on:{click:function(e){t.show=!1}}},[e("span",{staticClass:"d-inline-block text-white",attrs:{"aria-hidden":"true"}},[t._v("×")])])],1)]},proxy:!0}])},[e("div",{staticClass:"text-center"},[e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mr-1",attrs:{size:"sm",variant:"danger"},on:{click:function(e){t.show=!1}}},[t._v(" "+t._s(t.cancelButton)+" ")]),e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],attrs:{size:"sm",variant:"primary"},on:{click:function(e){return t.confirm()}}},[t._v(" "+t._s(t.confirmButton)+" ")])],1)])},s=[],n=a(15193),o=a(53862),i=a(20266);const c={components:{BButton:n.T,BPopover:o.x},directives:{Ripple:i.Z},props:{target:{type:String,required:!0},title:{type:String,required:!1,default:"Are You Sure?"},cancelButton:{type:String,required:!1,default:"Cancel"},confirmButton:{type:String,required:!0},width:{type:Number,required:!1,default:300}},data(){return{show:!1}},methods:{confirm(){this.show=!1,this.$emit("confirm")}}},l=c;var u=a(1001),d=(0,u.Z)(l,r,s,!1,null,null,null);const h=d.exports},71994:(t,e,a)=>{a.r(e),a.d(e,{default:()=>Z});var r=function(){var t=this,e=t._self._c;return e("div",[e("b-row",{staticClass:"match-height"},[e("b-col",{attrs:{sm:"12",lg:"6",xl:"4"}},[e("b-card",{attrs:{title:"Benchmark"}},[e("b-card-text",{staticClass:"mb-3"},[t._v(" An easy way to update your Benchmark daemon to the latest version. Benchmark will be automatically started once update is done. ")]),e("div",{staticClass:"text-center"},[e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],attrs:{id:"update-benchmark",variant:"success","aria-label":"Update Benchmark"}},[t._v(" Update Benchmark ")]),e("confirm-dialog",{attrs:{target:"update-benchmark","confirm-button":"Update Benchmark"},on:{confirm:function(e){return t.updateBenchmark()}}})],1)],1)],1),e("b-col",{attrs:{sm:"12",lg:"6",xl:"4"}},[e("b-card",{attrs:{title:"Manage Process"}},[e("b-card-text",{staticClass:"mb-3"},[t._v(" Here you can manage your Benchmark daemon process. ")]),e("div",{staticClass:"text-center"},[e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mx-1 mb-1",attrs:{id:"start-benchmark",variant:"success","aria-label":"Start Benchmark"}},[t._v(" Start Benchmark ")]),e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mx-1 mb-1",attrs:{id:"stop-benchmark",variant:"success","aria-label":"Stop Benchmark"}},[t._v(" Stop Benchmark ")]),e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mx-1 mb-1",attrs:{id:"restart-benchmark",variant:"success","aria-label":"Restart Benchmakr"}},[t._v(" Restart Benchmark ")]),e("confirm-dialog",{attrs:{target:"start-benchmark","confirm-button":"Start Benchmark"},on:{confirm:function(e){return t.startBenchmark()}}}),e("confirm-dialog",{attrs:{target:"stop-benchmark","confirm-button":"Stop Benchmark"},on:{confirm:function(e){return t.stopBenchmark()}}}),e("confirm-dialog",{attrs:{target:"restart-benchmark","confirm-button":"Restart Benchmark"},on:{confirm:function(e){return t.restartBenchmark()}}})],1)],1)],1),e("b-col",{attrs:{sm:"12",xl:"4"}},[e("b-card",{attrs:{title:"Restart"}},[e("b-card-text",{staticClass:"mb-2"},[t._v(" Option to trigger a complete new run of node benchmarking. Useful when your node falls down in category or fails benchmarking tests. ")]),e("div",{staticClass:"text-center"},[e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],attrs:{id:"restart-benchmarks",variant:"success","aria-label":"Restart Benchmarks"}},[t._v(" Restart Benchmarks ")]),e("confirm-dialog",{attrs:{target:"restart-benchmarks","confirm-button":"Restart Benchmarks"},on:{confirm:function(e){return t.restartBenchmarks()}}})],1)],1)],1)],1)],1)},s=[],n=a(86855),o=a(26253),i=a(50725),c=a(64206),l=a(15193),u=a(34547),d=a(20266),h=a(9669),m=a.n(h),g=a(87156),p=a(39055),f=a(39569);const b=a(80129),k={components:{BCard:n._,BRow:o.T,BCol:i.l,BCardText:c.j,BButton:l.T,ConfirmDialog:g.Z,ToastificationContent:u.Z},directives:{Ripple:d.Z},mounted(){this.checkBenchmarkVersion()},methods:{checkBenchmarkVersion(){f.Z.getInfo().then((t=>{console.log(t);const e=t.data.data.version;m().get("https://raw.githubusercontent.com/runonflux/flux/master/helpers/benchmarkinfo.json").then((t=>{console.log(t),t.data.version!==e?this.showToast("warning","Benchmark requires an update!"):this.showToast("success","Benchmark is up to date")})).catch((t=>{console.log(t),this.showToast("danger","Error verifying recent version")}))})).catch((t=>{console.log(t),this.showToast("danger","Error connecting to benchmark")}))},updateBenchmark(){f.Z.getInfo().then((t=>{console.log(t);const e=t.data.data.version;m().get("https://raw.githubusercontent.com/runonflux/flux/master/helpers/benchmarkinfo.json").then((t=>{if(console.log(t),t.data.version!==e){const t=localStorage.getItem("zelidauth"),e=b.parse(t);console.log(e),this.showToast("success","Benchmark is now updating in the background"),p.Z.updateBenchmark(t).then((t=>{console.log(t),"error"===t.data.status&&this.showToast("danger",t.data.data.message||t.data.data)})).catch((t=>{console.log(t),console.log(t.code),this.showToast("danger",t.toString())}))}else this.showToast("success","Benchmark is already up to date")})).catch((t=>{console.log(t),this.showToast("danger","Error verifying recent version")}))})).catch((t=>{console.log(t),this.showToast("danger","Error connecting to benchmark")}))},startBenchmark(){this.showToast("warning","Benchmark will start");const t=localStorage.getItem("zelidauth");f.Z.start(t).then((t=>{"error"===t.data.status?this.showToast("danger",t.data.data.message||t.data.data):this.showToast("success",t.data.data.message||t.data.data)})).catch((t=>{console.log(t),this.showToast("danger","Error while trying to start benchmark")}))},stopBenchmark(){this.showToast("warning","Benchmark will be stopped");const t=localStorage.getItem("zelidauth");f.Z.stop(t).then((t=>{"error"===t.data.status?this.showToast("danger",t.data.data.message||t.data.data):this.showToast("success",t.data.data.message||t.data.data)})).catch((t=>{console.log(t),this.showToast("danger","Error while trying to stop benchmark")}))},restartBenchmark(){this.showToast("warning","Benchmark will now restart");const t=localStorage.getItem("zelidauth");f.Z.restart(t).then((t=>{"error"===t.data.status?this.showToast("danger",t.data.data.message||t.data.data):this.showToast("success",t.data.data.message||t.data.data)})).catch((t=>{console.log(t),this.showToast("danger","Error while trying to restart benchmark")}))},restartBenchmarks(){this.showToast("warning","Initiating new benchmarks");const t=localStorage.getItem("zelidauth");f.Z.restartNodeBenchmarks(t).then((t=>{console.log(t),"error"===t.data.status?this.showToast("danger",t.data.data.message||t.data.data):this.showToast("success",t.data.data.message||t.data.data)})).catch((t=>{console.log(t),this.showToast("danger","Error while trying to run new benchmarks")}))},showToast(t,e,a="InfoIcon"){this.$toast({component:u.Z,props:{title:e,icon:a,variant:t}})}}},x=k;var v=a(1001),w=(0,v.Z)(x,r,s,!1,null,null,null);const Z=w.exports},39569:(t,e,a)=>{a.d(e,{Z:()=>s});var r=a(80914);const s={start(t){return(0,r.Z)().get("/benchmark/start",{headers:{zelidauth:t}})},restart(t){return(0,r.Z)().get("/benchmark/restart",{headers:{zelidauth:t}})},getStatus(){return(0,r.Z)().get("/benchmark/getstatus")},restartNodeBenchmarks(t){return(0,r.Z)().get("/benchmark/restartnodebenchmarks",{headers:{zelidauth:t}})},signFluxTransaction(t,e){return(0,r.Z)().get(`/benchmark/signzelnodetransaction/${e}`,{headers:{zelidauth:t}})},helpSpecific(t){return(0,r.Z)().get(`/benchmark/help/${t}`)},help(){return(0,r.Z)().get("/benchmark/help")},stop(t){return(0,r.Z)().get("/benchmark/stop",{headers:{zelidauth:t}})},getBenchmarks(){return(0,r.Z)().get("/benchmark/getbenchmarks")},getInfo(){return(0,r.Z)().get("/benchmark/getinfo")},tailBenchmarkDebug(t){return(0,r.Z)().get("/flux/tailbenchmarkdebug",{headers:{zelidauth:t}})},justAPI(){return(0,r.Z)()},cancelToken(){return r.S}}},39055:(t,e,a)=>{a.d(e,{Z:()=>s});var r=a(80914);const s={softUpdateFlux(t){return(0,r.Z)().get("/flux/softupdateflux",{headers:{zelidauth:t}})},softUpdateInstallFlux(t){return(0,r.Z)().get("/flux/softupdatefluxinstall",{headers:{zelidauth:t}})},updateFlux(t){return(0,r.Z)().get("/flux/updateflux",{headers:{zelidauth:t}})},hardUpdateFlux(t){return(0,r.Z)().get("/flux/hardupdateflux",{headers:{zelidauth:t}})},rebuildHome(t){return(0,r.Z)().get("/flux/rebuildhome",{headers:{zelidauth:t}})},updateDaemon(t){return(0,r.Z)().get("/flux/updatedaemon",{headers:{zelidauth:t}})},reindexDaemon(t){return(0,r.Z)().get("/flux/reindexdaemon",{headers:{zelidauth:t}})},updateBenchmark(t){return(0,r.Z)().get("/flux/updatebenchmark",{headers:{zelidauth:t}})},getFluxVersion(){return(0,r.Z)().get("/flux/version")},broadcastMessage(t,e){const a=e,s={headers:{zelidauth:t}};return(0,r.Z)().post("/flux/broadcastmessage",JSON.stringify(a),s)},connectedPeers(){return(0,r.Z)().get(`/flux/connectedpeers?timestamp=${Date.now()}`)},connectedPeersInfo(){return(0,r.Z)().get(`/flux/connectedpeersinfo?timestamp=${Date.now()}`)},incomingConnections(){return(0,r.Z)().get(`/flux/incomingconnections?timestamp=${Date.now()}`)},incomingConnectionsInfo(){return(0,r.Z)().get(`/flux/incomingconnectionsinfo?timestamp=${Date.now()}`)},addPeer(t,e){return(0,r.Z)().get(`/flux/addpeer/${e}`,{headers:{zelidauth:t}})},removePeer(t,e){return(0,r.Z)().get(`/flux/removepeer/${e}`,{headers:{zelidauth:t}})},removeIncomingPeer(t,e){return(0,r.Z)().get(`/flux/removeincomingpeer/${e}`,{headers:{zelidauth:t}})},adjustCruxID(t,e){return(0,r.Z)().get(`/flux/adjustcruxid/${e}`,{headers:{zelidauth:t}})},adjustKadena(t,e,a){return(0,r.Z)().get(`/flux/adjustkadena/${e}/${a}`,{headers:{zelidauth:t}})},adjustRouterIP(t,e){return(0,r.Z)().get(`/flux/adjustrouterip/${e}`,{headers:{zelidauth:t}})},adjustBlockedPorts(t,e){const a={blockedPorts:e},s={headers:{zelidauth:t}};return(0,r.Z)().post("/flux/adjustblockedports",JSON.stringify(a),s)},adjustAPIPort(t,e){return(0,r.Z)().get(`/flux/adjustapiport/${e}`,{headers:{zelidauth:t}})},adjustBlockedRepositories(t,e){const a={blockedRepositories:e},s={headers:{zelidauth:t}};return(0,r.Z)().post("/flux/adjustblockedrepositories",JSON.stringify(a),s)},getCruxID(){const t={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/cruxid",t)},getKadenaAccount(){const t={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/kadena",t)},getRouterIP(){const t={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/routerip",t)},getBlockedPorts(){const t={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/blockedports",t)},getAPIPort(){const t={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/apiport",t)},getBlockedRepositories(){const t={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/blockedrepositories",t)},getMarketPlaceURL(){return(0,r.Z)().get("/flux/marketplaceurl")},getZelid(){const t={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/zelid",t)},getStaticIpInfo(){return(0,r.Z)().get("/flux/staticip")},restartFluxOS(t){const e={headers:{zelidauth:t,"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/restart",e)},tailFluxLog(t,e){return(0,r.Z)().get(`/flux/tail${t}log`,{headers:{zelidauth:e}})},justAPI(){return(0,r.Z)()},cancelToken(){return r.S}}}}]);