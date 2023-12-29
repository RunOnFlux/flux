"use strict";(globalThis["webpackChunkflux"]=globalThis["webpackChunkflux"]||[]).push([[9897],{66644:(e,t,a)=>{a.r(t),a.d(t,{default:()=>k});var r=function(){var e=this,t=e.$createElement,a=e._self._c||t;return a("div",[a("h6",{staticClass:"mb-1"},[e._v(" Click the 'Download File' button to download the log. This may take a few minutes depending on file size. ")]),a("h6",{staticClass:"mb-1"},[e._v(" Click the 'Show File' button to view the last 100 lines of the log file. ")]),a("b-row",e._l(e.logTypes,(function(t){return a("b-col",{key:t},[a("b-card",{attrs:{title:e.capitalizeWord(t)+" File"}},[a("div",[a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mr-1",attrs:{id:"start-download-"+t,variant:"outline-primary",size:"md",block:""}},[e._v(" Download File ")]),e.total[t]&&e.downloaded[t]?a("div",{staticClass:"d-flex",staticStyle:{width:"300px"}},[a("b-card-text",{staticClass:"mt-1 mb-0 mr-auto"},[e._v(" "+e._s((e.downloaded[t]/1e6).toFixed(2)+" / "+(e.total[t]/1e6).toFixed(2))+" MB - "+e._s((e.downloaded[t]/e.total[t]*100).toFixed(2)+"%")+" ")]),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"btn-icon cancel-button",attrs:{variant:"danger",size:"sm"},on:{click:function(a){return e.cancelDownload(t)}}},[e._v(" x ")])],1):e._e(),a("b-popover",{ref:"popover",refInFor:!0,attrs:{target:"start-download-"+t,triggers:"click",show:e.downloadPopoverShow[t],placement:"auto",container:"my-container"},on:{"update:show":function(a){return e.$set(e.downloadPopoverShow,t,a)}},scopedSlots:e._u([{key:"title",fn:function(){return[a("div",{staticClass:"d-flex justify-content-between align-items-center"},[a("span",[e._v("Are You Sure?")]),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"close",attrs:{variant:"transparent","aria-label":"Close"},on:{click:function(a){return e.onDownloadClose(t)}}},[a("span",{staticClass:"d-inline-block text-white",attrs:{"aria-hidden":"true"}},[e._v("×")])])],1)]},proxy:!0}],null,!0)},[a("div",[a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mr-1",attrs:{size:"sm",variant:"danger"},on:{click:function(a){return e.onDownloadClose(t)}}},[e._v(" Cancel ")]),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],attrs:{size:"sm",variant:"primary"},on:{click:function(a){return e.onDownloadOk(t)}}},[e._v(" Download "+e._s(e.capitalizeWord(t))+" ")])],1)]),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mr-1 mt-1",attrs:{id:"start-tail-"+t,variant:"outline-primary",size:"md",block:""}},[e._v(" Show File ")]),a("b-popover",{ref:"popover",refInFor:!0,attrs:{target:"start-tail-"+t,triggers:"click",show:e.tailPopoverShow[t],placement:"auto",container:"my-container"},on:{"update:show":function(a){return e.$set(e.tailPopoverShow,t,a)}},scopedSlots:e._u([{key:"title",fn:function(){return[a("div",{staticClass:"d-flex justify-content-between align-items-center"},[a("span",[e._v("Are You Sure?")]),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"close",attrs:{variant:"transparent","aria-label":"Close"},on:{click:function(a){return e.onTailClose(t)}}},[a("span",{staticClass:"d-inline-block text-white",attrs:{"aria-hidden":"true"}},[e._v("×")])])],1)]},proxy:!0}],null,!0)},[a("div",[a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mr-1",attrs:{size:"sm",variant:"danger"},on:{click:function(a){return e.onTailClose(t)}}},[e._v(" Cancel ")]),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],attrs:{size:"sm",variant:"primary"},on:{click:function(a){return e.onTailOk(t)}}},[e._v(" Show "+e._s(e.capitalizeWord(t))+" ")])],1)])],1)])],1)})),1),e.callResponse.data.message?a("b-card",[a("b-form-textarea",{staticClass:"mt-1",attrs:{plaintext:"","no-resize":"",rows:"30",value:e.callResponse.data.message}})],1):e._e()],1)},o=[],n=(a(98858),a(61318),a(33228),a(23215)),s=a(50725),i=a(26253),l=a(15193),u=a(72417),d=a(85961),c=a(64206),p=a(3899),h=a(20266),g=a(9669),f=a.n(g),m=a(39055);const v={components:{BCard:n._,BCol:s.l,BRow:i.T,BButton:l.T,BPopover:u.x,BFormTextarea:d.y,BCardText:c.j,ToastificationContent:p.Z},directives:{Ripple:h.Z},data(){return{downloadPopoverShow:{},tailPopoverShow:{},abortToken:{},downloaded:{},total:{},callResponse:{status:"",data:{}},logTypes:["error","warn","info","debug"]}},computed:{fluxLogTail(){return this.callResponse.data.message?this.callResponse.data.message.split("\n").reverse().filter((e=>""!==e)).join("\n"):this.callResponse.data}},methods:{cancelDownload(e){this.abortToken[e].cancel("User download cancelled"),this.downloaded[e]="",this.total[e]=""},onDownloadClose(e){this.downloadPopoverShow[e]=!1},async onDownloadOk(e){const t=this;t.abortToken[e]&&t.abortToken[e].cancel(),this.downloadPopoverShow[e]=!1;const a=f().CancelToken,r=a.source();this.abortToken[e]=r;const o=localStorage.getItem("zelidauth"),n={headers:{zelidauth:o},responseType:"blob",onDownloadProgress(a){t.downloaded[e]=a.loaded,t.total[e]=a.total,t.$forceUpdate()},cancelToken:t.abortToken[e].token},s=await m.Z.justAPI().get(`/flux/${e}log`,n),i=window.URL.createObjectURL(new Blob([s.data])),l=document.createElement("a");l.href=i,l.setAttribute("download",`${e}.log`),document.body.appendChild(l),l.click()},onTailClose(e){this.tailPopoverShow[e]=!1},async onTailOk(e){this.tailPopoverShow[e]=!1;const t=localStorage.getItem("zelidauth");m.Z.tailFluxLog(e,t).then((e=>{"error"===e.data.status?this.$toast({component:p.Z,props:{title:e.data.data.message||e.data.data,icon:"InfoIcon",variant:"danger"}}):(this.callResponse.status=e.data.status,this.callResponse.data=e.data.data)})).catch((t=>{this.$toast({component:p.Z,props:{title:`Error while trying to get latest ${e} log`,icon:"InfoIcon",variant:"danger"}}),console.log(t)}))},capitalizeWord(e){return e[0].toUpperCase()+e.slice(1)}}},b=v;var x=a(1001),w=(0,x.Z)(b,r,o,!1,null,null,null);const k=w.exports},39055:(e,t,a)=>{a.d(t,{Z:()=>o});var r=a(80914);const o={softUpdateFlux(e){return(0,r.Z)().get("/flux/softupdateflux",{headers:{zelidauth:e}})},softUpdateInstallFlux(e){return(0,r.Z)().get("/flux/softupdatefluxinstall",{headers:{zelidauth:e}})},updateFlux(e){return(0,r.Z)().get("/flux/updateflux",{headers:{zelidauth:e}})},hardUpdateFlux(e){return(0,r.Z)().get("/flux/hardupdateflux",{headers:{zelidauth:e}})},rebuildHome(e){return(0,r.Z)().get("/flux/rebuildhome",{headers:{zelidauth:e}})},updateDaemon(e){return(0,r.Z)().get("/flux/updatedaemon",{headers:{zelidauth:e}})},reindexDaemon(e){return(0,r.Z)().get("/flux/reindexdaemon",{headers:{zelidauth:e}})},updateBenchmark(e){return(0,r.Z)().get("/flux/updatebenchmark",{headers:{zelidauth:e}})},getFluxVersion(){return(0,r.Z)().get("/flux/version")},broadcastMessage(e,t){const a=t,o={headers:{zelidauth:e}};return(0,r.Z)().post("/flux/broadcastmessage",JSON.stringify(a),o)},connectedPeers(){return(0,r.Z)().get(`/flux/connectedpeers?timestamp=${(new Date).getTime()}`)},connectedPeersInfo(){return(0,r.Z)().get(`/flux/connectedpeersinfo?timestamp=${(new Date).getTime()}`)},incomingConnections(){return(0,r.Z)().get(`/flux/incomingconnections?timestamp=${(new Date).getTime()}`)},incomingConnectionsInfo(){return(0,r.Z)().get(`/flux/incomingconnectionsinfo?timestamp=${(new Date).getTime()}`)},addPeer(e,t){return(0,r.Z)().get(`/flux/addpeer/${t}`,{headers:{zelidauth:e}})},removePeer(e,t){return(0,r.Z)().get(`/flux/removepeer/${t}`,{headers:{zelidauth:e}})},removeIncomingPeer(e,t){return(0,r.Z)().get(`/flux/removeincomingpeer/${t}`,{headers:{zelidauth:e}})},adjustCruxID(e,t){return(0,r.Z)().get(`/flux/adjustcruxid/${t}`,{headers:{zelidauth:e}})},adjustKadena(e,t,a){return(0,r.Z)().get(`/flux/adjustkadena/${t}/${a}`,{headers:{zelidauth:e}})},adjustRouterIP(e,t){return(0,r.Z)().get(`/flux/adjustrouterip/${t}`,{headers:{zelidauth:e}})},adjustBlockedPorts(e,t){const a={blockedPorts:t},o={headers:{zelidauth:e}};return(0,r.Z)().post("/flux/adjustblockedports",JSON.stringify(a),o)},adjustAPIPort(e,t){return(0,r.Z)().get(`/flux/adjustapiport/${t}`,{headers:{zelidauth:e}})},adjustBlockedRepositories(e,t){const a={blockedRepositories:t},o={headers:{zelidauth:e}};return(0,r.Z)().post("/flux/adjustblockedrepositories",JSON.stringify(a),o)},getCruxID(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/cruxid",e)},getKadenaAccount(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/kadena",e)},getRouterIP(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/routerip",e)},getBlockedPorts(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/blockedports",e)},getAPIPort(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/apiport",e)},getBlockedRepositories(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/blockedrepositories",e)},getMarketPlaceURL(){return(0,r.Z)().get("/flux/marketplaceurl")},getZelid(){const e={headers:{"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/zelid",e)},getStaticIpInfo(){return(0,r.Z)().get("/flux/staticip")},restartFluxOS(e){const t={headers:{zelidauth:e,"x-apicache-bypass":!0}};return(0,r.Z)().get("/flux/restart",t)},tailFluxLog(e,t){return(0,r.Z)().get(`/flux/tail${e}log`,{headers:{zelidauth:t}})},justAPI(){return(0,r.Z)()},cancelToken(){return r.S}}},50926:(e,t,a)=>{var r=a(23043),o=a(69985),n=a(6648),s=a(44201),i=s("toStringTag"),l=Object,u="Arguments"===n(function(){return arguments}()),d=function(e,t){try{return e[t]}catch(a){}};e.exports=r?n:function(e){var t,a,r;return void 0===e?"Undefined":null===e?"Null":"string"==typeof(a=d(t=l(e),i))?a:u?n(t):"Object"===(r=n(t))&&o(t.callee)?"Arguments":r}},62148:(e,t,a)=>{var r=a(98702),o=a(72560);e.exports=function(e,t,a){return a.get&&r(a.get,t,{getter:!0}),a.set&&r(a.set,t,{setter:!0}),o.f(e,t,a)}},23043:(e,t,a)=>{var r=a(44201),o=r("toStringTag"),n={};n[o]="z",e.exports="[object z]"===String(n)},34327:(e,t,a)=>{var r=a(50926),o=String;e.exports=function(e){if("Symbol"===r(e))throw new TypeError("Cannot convert a Symbol value to a string");return o(e)}},21500:e=>{var t=TypeError;e.exports=function(e,a){if(e<a)throw new t("Not enough arguments");return e}},98858:(e,t,a)=>{var r=a(11880),o=a(68844),n=a(34327),s=a(21500),i=URLSearchParams,l=i.prototype,u=o(l.append),d=o(l["delete"]),c=o(l.forEach),p=o([].push),h=new i("a=1&a=2&b=3");h["delete"]("a",1),h["delete"]("b",void 0),h+""!=="a=2"&&r(l,"delete",(function(e){var t=arguments.length,a=t<2?void 0:arguments[1];if(t&&void 0===a)return d(this,e);var r=[];c(this,(function(e,t){p(r,{key:t,value:e})})),s(t,1);var o,i=n(e),l=n(a),h=0,g=0,f=!1,m=r.length;while(h<m)o=r[h++],f||o.key===i?(f=!0,d(this,o.key)):g++;while(g<m)o=r[g++],o.key===i&&o.value===l||u(this,o.key,o.value)}),{enumerable:!0,unsafe:!0})},61318:(e,t,a)=>{var r=a(11880),o=a(68844),n=a(34327),s=a(21500),i=URLSearchParams,l=i.prototype,u=o(l.getAll),d=o(l.has),c=new i("a=1");!c.has("a",2)&&c.has("a",void 0)||r(l,"has",(function(e){var t=arguments.length,a=t<2?void 0:arguments[1];if(t&&void 0===a)return d(this,e);var r=u(this,e);s(t,1);var o=n(a),i=0;while(i<r.length)if(r[i++]===o)return!0;return!1}),{enumerable:!0,unsafe:!0})},33228:(e,t,a)=>{var r=a(67697),o=a(68844),n=a(62148),s=URLSearchParams.prototype,i=o(s.forEach);r&&!("size"in s)&&n(s,"size",{get:function(){var e=0;return i(this,(function(){e++})),e},configurable:!0,enumerable:!0})}}]);