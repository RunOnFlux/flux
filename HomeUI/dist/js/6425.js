"use strict";(globalThis["webpackChunkflux"]=globalThis["webpackChunkflux"]||[]).push([[6425],{3899:(t,e,a)=>{a.d(e,{Z:()=>c});var n=function(){var t=this,e=t.$createElement,a=t._self._c||e;return a("div",{staticClass:"toastification"},[a("div",{staticClass:"d-flex align-items-start"},[a("b-avatar",{staticClass:"mr-75 flex-shrink-0",attrs:{variant:t.variant,size:"1.8rem"}},[a("feather-icon",{attrs:{icon:t.icon,size:"15"}})],1),a("div",{staticClass:"d-flex flex-grow-1"},[a("div",[t.title?a("h5",{staticClass:"mb-0 font-weight-bolder toastification-title",class:"text-"+t.variant,domProps:{textContent:t._s(t.title)}}):t._e(),t.text?a("small",{staticClass:"d-inline-block text-body",domProps:{textContent:t._s(t.text)}}):t._e()]),a("span",{staticClass:"cursor-pointer toastification-close-icon ml-auto ",on:{click:function(e){return t.$emit("close-toast")}}},[t.hideClose?t._e():a("feather-icon",{staticClass:"text-body",attrs:{icon:"XIcon"}})],1)])],1)])},r=[],s=a(47389);const o={components:{BAvatar:s.SH},props:{variant:{type:String,default:"primary"},icon:{type:String,default:null},title:{type:String,default:null},text:{type:String,default:null},hideClose:{type:Boolean,default:!1}}},i=o;var l=a(1001),d=(0,l.Z)(i,n,r,!1,null,"22d964ca",null);const c=d.exports},56425:(t,e,a)=>{a.r(e),a.d(e,{default:()=>x});var n=function(){var t=this,e=t.$createElement,a=t._self._c||e;return a("b-card",[a("b-card-text",[t._v(" Please paste a Transaction ID below to get the raw transaction data ")]),a("b-form-input",{attrs:{placeholder:"Transaction ID"},model:{value:t.txid,callback:function(e){t.txid=e},expression:"txid"}}),a("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"my-1",attrs:{variant:"outline-primary",size:"md"},on:{click:t.daemonGetRawTransaction}},[t._v(" Get Transaction ")]),t.callResponse.data?a("b-form-textarea",{attrs:{plaintext:"","no-resize":"",rows:"30",value:t.callResponse.data}}):t._e()],1)},r=[],s=a(23215),o=a(64206),i=a(15193),l=a(22183),d=a(85961),c=a(3899),u=a(20266),g=a(27616);const m={components:{BCard:s._,BCardText:o.j,BButton:i.T,BFormInput:l.e,BFormTextarea:d.y,ToastificationContent:c.Z},directives:{Ripple:u.Z},data(){return{txid:"",callResponse:{status:"",data:""}}},methods:{async daemonGetRawTransaction(){const t=await g.Z.getRawTransaction(this.txid,1);"error"===t.data.status?this.$toast({component:c.Z,props:{title:t.data.data.message||t.data.data,icon:"InfoIcon",variant:"danger"}}):(this.callResponse.status=t.data.status,this.callResponse.data=JSON.stringify(t.data.data,null,4))}}},h=m;var p=a(1001),f=(0,p.Z)(h,n,r,!1,null,null,null);const x=f.exports},27616:(t,e,a)=>{a.d(e,{Z:()=>r});var n=a(80914);const r={help(){return(0,n.Z)().get("/daemon/help")},helpSpecific(t){return(0,n.Z)().get(`/daemon/help/${t}`)},getInfo(){return(0,n.Z)().get("/daemon/getinfo")},getFluxNodeStatus(){return(0,n.Z)().get("/daemon/getzelnodestatus")},getRawTransaction(t,e){return(0,n.Z)().get(`/daemon/getrawtransaction/${t}/${e}`)},listFluxNodes(){return(0,n.Z)().get("/daemon/listzelnodes")},viewDeterministicFluxNodeList(){return(0,n.Z)().get("/daemon/viewdeterministiczelnodelist")},getFluxNodeCount(){return(0,n.Z)().get("/daemon/getzelnodecount")},getStartList(){return(0,n.Z)().get("/daemon/getstartlist")},getDOSList(){return(0,n.Z)().get("/daemon/getdoslist")},fluxCurrentWinner(){return(0,n.Z)().get("/daemon/fluxcurrentwinner")},getBenchmarks(){return(0,n.Z)().get("/daemon/getbenchmarks")},getBenchStatus(){return(0,n.Z)().get("/daemon/getbenchstatus")},startBenchmark(t){return(0,n.Z)().get("/daemon/startbenchmark",{headers:{zelidauth:t}})},stopBenchmark(t){return(0,n.Z)().get("/daemon/stopbenchmark",{headers:{zelidauth:t}})},getBlockchainInfo(){return(0,n.Z)().get("/daemon/getblockchaininfo")},getMiningInfo(){return(0,n.Z)().get("/daemon/getmininginfo")},getNetworkInfo(){return(0,n.Z)().get("/daemon/getnetworkinfo")},validateAddress(t,e){return(0,n.Z)().get(`/daemon/validateaddress/${e}`,{headers:{zelidauth:t}})},getWalletInfo(t){return(0,n.Z)().get("/daemon/getwalletinfo",{headers:{zelidauth:t}})},listFluxNodeConf(t){return(0,n.Z)().get("/daemon/listzelnodeconf",{headers:{zelidauth:t}})},start(t){return(0,n.Z)().get("/daemon/start",{headers:{zelidauth:t}})},restart(t){return(0,n.Z)().get("/daemon/restart",{headers:{zelidauth:t}})},stopDaemon(t){return(0,n.Z)().get("/daemon/stop",{headers:{zelidauth:t}})},rescanDaemon(t,e){return(0,n.Z)().get(`/daemon/rescanblockchain/${e}`,{headers:{zelidauth:t}})},getBlock(t,e){return(0,n.Z)().get(`/daemon/getblock/${t}/${e}`)},tailDaemonDebug(t){return(0,n.Z)().get("/flux/taildaemondebug",{headers:{zelidauth:t}})},justAPI(){return(0,n.Z)()},cancelToken(){return n.S}}}}]);