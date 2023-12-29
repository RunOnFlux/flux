"use strict";(globalThis["webpackChunkflux"]=globalThis["webpackChunkflux"]||[]).push([[767],{3899:(t,e,a)=>{a.d(e,{Z:()=>c});var s=function(){var t=this,e=t.$createElement,a=t._self._c||e;return a("div",{staticClass:"toastification"},[a("div",{staticClass:"d-flex align-items-start"},[a("b-avatar",{staticClass:"mr-75 flex-shrink-0",attrs:{variant:t.variant,size:"1.8rem"}},[a("feather-icon",{attrs:{icon:t.icon,size:"15"}})],1),a("div",{staticClass:"d-flex flex-grow-1"},[a("div",[t.title?a("h5",{staticClass:"mb-0 font-weight-bolder toastification-title",class:"text-"+t.variant,domProps:{textContent:t._s(t.title)}}):t._e(),t.text?a("small",{staticClass:"d-inline-block text-body",domProps:{textContent:t._s(t.text)}}):t._e()]),a("span",{staticClass:"cursor-pointer toastification-close-icon ml-auto ",on:{click:function(e){return t.$emit("close-toast")}}},[t.hideClose?t._e():a("feather-icon",{staticClass:"text-body",attrs:{icon:"XIcon"}})],1)])],1)])},n=[],r=a(47389);const l={components:{BAvatar:r.SH},props:{variant:{type:String,default:"primary"},icon:{type:String,default:null},title:{type:String,default:null},text:{type:String,default:null},hideClose:{type:Boolean,default:!1}}},o=l;var i=a(1001),d=(0,i.Z)(o,s,n,!1,null,"22d964ca",null);const c=d.exports},59727:(t,e,a)=>{a.d(e,{Z:()=>c});var s=function(){var t=this,e=t.$createElement,a=t._self._c||e;return a("dl",{staticClass:"row",class:t.classes},[a("dt",{staticClass:"col-sm-3"},[t._v(" "+t._s(t.title)+" ")]),t.href.length>0?a("dd",{staticClass:"col-sm-9 mb-0",class:"text-"+t.variant},[t.href.length>0?a("b-link",{attrs:{href:t.href,target:"_blank",rel:"noopener noreferrer"}},[t._v(" "+t._s(t.data.length>0?t.data:t.number!==Number.MAX_VALUE?t.number:"")+" ")]):t._e()],1):t.click?a("dd",{staticClass:"col-sm-9 mb-0",class:"text-"+t.variant,on:{click:function(e){return t.$emit("click")}}},[a("b-link",[t._v(" "+t._s(t.data.length>0?t.data:t.number!==Number.MAX_VALUE?t.number:"")+" ")])],1):a("dd",{staticClass:"col-sm-9 mb-0",class:"text-"+t.variant},[t._v(" "+t._s(t.data.length>0?t.data:t.number!==Number.MAX_VALUE?t.number:"")+" ")])])},n=[],r=a(67347);const l={components:{BLink:r.we},props:{title:{type:String,required:!0},classes:{type:String,required:!1,default:"mb-1"},data:{type:String,required:!1,default:""},number:{type:Number,required:!1,default:Number.MAX_VALUE},variant:{type:String,required:!1,default:"secondary"},href:{type:String,required:!1,default:""},click:{type:Boolean,required:!1,default:!1}}},o=l;var i=a(1001),d=(0,i.Z)(o,s,n,!1,null,null,null);const c=d.exports},20767:(t,e,a)=>{a.r(e),a.d(e,{default:()=>g});var s=function(){var t=this,e=t.$createElement,a=t._self._c||e;return""!==t.callResponse.data?a("b-card",{attrs:{title:"Get Benchmarks"}},[t.callResponse.data.status?a("list-entry",{attrs:{title:"Status",data:t.callResponse.data.status}}):t._e(),t.callResponse.data.time?a("list-entry",{attrs:{title:"Time",data:new Date(1e3*t.callResponse.data.time).toLocaleString("en-GB",t.timeoptions.short)}}):t._e(),t.callResponse.data.ipaddress?a("list-entry",{attrs:{title:"IP Address",data:t.callResponse.data.ipaddress}}):t._e(),t.callResponse.data.cores?a("list-entry",{attrs:{title:"CPU Cores",number:t.callResponse.data.cores}}):t._e(),t.callResponse.data.ram?a("list-entry",{attrs:{title:"RAM",data:t.callResponse.data.ram+" GB"}}):t._e(),t.callResponse.data.disksinfo&&t.callResponse.data.disksinfo.length>0?a("list-entry",{attrs:{title:"Disk(s) Info (Name/Size(GB)/Write Speed(MB/s))",data:""+JSON.stringify(t.callResponse.data.disksinfo)}}):t._e(),t.callResponse.data.eps?a("list-entry",{attrs:{title:"CPU Speed",data:t.callResponse.data.eps+" eps"}}):t._e(),t.callResponse.data.download_speed?a("list-entry",{attrs:{title:"Download Speed",data:t.callResponse.data.download_speed.toFixed(2)+" Mb/s"}}):t._e(),t.callResponse.data.upload_speed?a("list-entry",{attrs:{title:"Upload Speed",data:t.callResponse.data.upload_speed.toFixed(2)+" Mb/s"}}):t._e(),t.callResponse.data.ping?a("list-entry",{attrs:{title:"Ping",data:t.callResponse.data.ping.toFixed(2)+" ms"}}):t._e(),t.callResponse.data.errors?a("list-entry",{attrs:{title:"Error",data:t.callResponse.data.errors,variant:"danger"}}):t._e()],1):t._e()},n=[],r=a(23215),l=a(3899),o=a(59727),i=a(27616);const d=a(63005),c={components:{ListEntry:o.Z,BCard:r._,ToastificationContent:l.Z},data(){return{timeoptions:d,callResponse:{status:"",data:""}}},mounted(){this.daemonGetBenchmarks()},methods:{async daemonGetBenchmarks(){const t=await i.Z.getBenchmarks();"error"===t.data.status?this.$toast({component:l.Z,props:{title:t.data.data.message||t.data.data,icon:"InfoIcon",variant:"danger"}}):(this.callResponse.status=t.data.status,this.callResponse.data=JSON.parse(t.data.data))}}},u=c;var m=a(1001),p=(0,m.Z)(u,s,n,!1,null,null,null);const g=p.exports},63005:(t,e,a)=>{a.r(e),a.d(e,{default:()=>r});const s={year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"},n={year:"numeric",month:"short",day:"numeric"},r={shortDate:s,date:n}},27616:(t,e,a)=>{a.d(e,{Z:()=>n});var s=a(80914);const n={help(){return(0,s.Z)().get("/daemon/help")},helpSpecific(t){return(0,s.Z)().get(`/daemon/help/${t}`)},getInfo(){return(0,s.Z)().get("/daemon/getinfo")},getFluxNodeStatus(){return(0,s.Z)().get("/daemon/getzelnodestatus")},getRawTransaction(t,e){return(0,s.Z)().get(`/daemon/getrawtransaction/${t}/${e}`)},listFluxNodes(){return(0,s.Z)().get("/daemon/listzelnodes")},viewDeterministicFluxNodeList(){return(0,s.Z)().get("/daemon/viewdeterministiczelnodelist")},getFluxNodeCount(){return(0,s.Z)().get("/daemon/getzelnodecount")},getStartList(){return(0,s.Z)().get("/daemon/getstartlist")},getDOSList(){return(0,s.Z)().get("/daemon/getdoslist")},fluxCurrentWinner(){return(0,s.Z)().get("/daemon/fluxcurrentwinner")},getBenchmarks(){return(0,s.Z)().get("/daemon/getbenchmarks")},getBenchStatus(){return(0,s.Z)().get("/daemon/getbenchstatus")},startBenchmark(t){return(0,s.Z)().get("/daemon/startbenchmark",{headers:{zelidauth:t}})},stopBenchmark(t){return(0,s.Z)().get("/daemon/stopbenchmark",{headers:{zelidauth:t}})},getBlockchainInfo(){return(0,s.Z)().get("/daemon/getblockchaininfo")},getMiningInfo(){return(0,s.Z)().get("/daemon/getmininginfo")},getNetworkInfo(){return(0,s.Z)().get("/daemon/getnetworkinfo")},validateAddress(t,e){return(0,s.Z)().get(`/daemon/validateaddress/${e}`,{headers:{zelidauth:t}})},getWalletInfo(t){return(0,s.Z)().get("/daemon/getwalletinfo",{headers:{zelidauth:t}})},listFluxNodeConf(t){return(0,s.Z)().get("/daemon/listzelnodeconf",{headers:{zelidauth:t}})},start(t){return(0,s.Z)().get("/daemon/start",{headers:{zelidauth:t}})},restart(t){return(0,s.Z)().get("/daemon/restart",{headers:{zelidauth:t}})},stopDaemon(t){return(0,s.Z)().get("/daemon/stop",{headers:{zelidauth:t}})},rescanDaemon(t,e){return(0,s.Z)().get(`/daemon/rescanblockchain/${e}`,{headers:{zelidauth:t}})},getBlock(t,e){return(0,s.Z)().get(`/daemon/getblock/${t}/${e}`)},tailDaemonDebug(t){return(0,s.Z)().get("/flux/taildaemondebug",{headers:{zelidauth:t}})},justAPI(){return(0,s.Z)()},cancelToken(){return s.S}}}}]);