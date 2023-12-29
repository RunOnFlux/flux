"use strict";(globalThis["webpackChunkflux"]=globalThis["webpackChunkflux"]||[]).push([[8075],{3899:(t,e,a)=>{a.d(e,{Z:()=>c});var s=function(){var t=this,e=t.$createElement,a=t._self._c||e;return a("div",{staticClass:"toastification"},[a("div",{staticClass:"d-flex align-items-start"},[a("b-avatar",{staticClass:"mr-75 flex-shrink-0",attrs:{variant:t.variant,size:"1.8rem"}},[a("feather-icon",{attrs:{icon:t.icon,size:"15"}})],1),a("div",{staticClass:"d-flex flex-grow-1"},[a("div",[t.title?a("h5",{staticClass:"mb-0 font-weight-bolder toastification-title",class:"text-"+t.variant,domProps:{textContent:t._s(t.title)}}):t._e(),t.text?a("small",{staticClass:"d-inline-block text-body",domProps:{textContent:t._s(t.text)}}):t._e()]),a("span",{staticClass:"cursor-pointer toastification-close-icon ml-auto ",on:{click:function(e){return t.$emit("close-toast")}}},[t.hideClose?t._e():a("feather-icon",{staticClass:"text-body",attrs:{icon:"XIcon"}})],1)])],1)])},r=[],n=a(47389);const l={components:{BAvatar:n.SH},props:{variant:{type:String,default:"primary"},icon:{type:String,default:null},title:{type:String,default:null},text:{type:String,default:null},hideClose:{type:Boolean,default:!1}}},i=l;var o=a(1001),d=(0,o.Z)(i,s,r,!1,null,"22d964ca",null);const c=d.exports},18075:(t,e,a)=>{a.r(e),a.d(e,{default:()=>h});var s=function(){var t=this,e=t.$createElement,a=t._self._c||e;return""!==t.callResponse.data?a("b-card",{attrs:{title:"Get Benchmarks"}},[t.callResponse.data.status?a("list-entry",{attrs:{title:"Status",data:t.callResponse.data.status}}):t._e(),t.callResponse.data.architecture?a("list-entry",{attrs:{title:"Architecture",data:t.callResponse.data.architecture}}):t._e(),t.callResponse.data.time?a("list-entry",{attrs:{title:"Time",data:new Date(1e3*t.callResponse.data.time).toLocaleString("en-GB",t.timeoptions.short)}}):t._e(),t.callResponse.data.ipaddress?a("list-entry",{attrs:{title:"IP Address",data:t.callResponse.data.ipaddress}}):t._e(),t.callResponse.data.real_cores?a("list-entry",{attrs:{title:"CPU Cores",number:t.callResponse.data.real_cores}}):t._e(),t.callResponse.data.cores?a("list-entry",{attrs:{title:"CPU Threads",number:t.callResponse.data.cores}}):t._e(),t.callResponse.data.ram?a("list-entry",{attrs:{title:"RAM",data:t.callResponse.data.ram+" GB"}}):t._e(),t.callResponse.data.disksinfo&&t.callResponse.data.disksinfo.length>0?a("list-entry",{attrs:{title:"Disk(s) (Name/Size(GB)/Write Speed(MB/s))",data:""+JSON.stringify(t.callResponse.data.disksinfo)}}):t._e(),t.callResponse.data.eps?a("list-entry",{attrs:{title:"CPU Speed",data:t.callResponse.data.eps.toFixed(2)+" eps"}}):t._e(),t.callResponse.data.download_speed?a("list-entry",{attrs:{title:"Download Speed",data:t.callResponse.data.download_speed.toFixed(2)+" Mb/s"}}):t._e(),t.callResponse.data.upload_speed?a("list-entry",{attrs:{title:"Upload Speed",data:t.callResponse.data.upload_speed.toFixed(2)+" Mb/s"}}):t._e(),t.callResponse.data.ping?a("list-entry",{attrs:{title:"Ping",data:t.callResponse.data.ping.toFixed(2)+" ms"}}):t._e(),t.callResponse.data.error?a("list-entry",{attrs:{title:"Error",data:t.callResponse.data.error,variant:"danger"}}):t._e()],1):t._e()},r=[],n=a(23215),l=a(3899),i=a(59727),o=a(39569);const d=a(63005),c={components:{ListEntry:i.Z,BCard:n._,ToastificationContent:l.Z},data(){return{timeoptions:d,callResponse:{status:"",data:""}}},mounted(){this.benchmarkGetBenchmarks()},methods:{async benchmarkGetBenchmarks(){const t=await o.Z.getBenchmarks();"error"===t.data.status?this.$toast({component:l.Z,props:{title:t.data.data.message||t.data.data,icon:"InfoIcon",variant:"danger"}}):(this.callResponse.status=t.data.status,this.callResponse.data=t.data.data)}}},u=c;var p=a(1001),m=(0,p.Z)(u,s,r,!1,null,null,null);const h=m.exports},59727:(t,e,a)=>{a.d(e,{Z:()=>c});var s=function(){var t=this,e=t.$createElement,a=t._self._c||e;return a("dl",{staticClass:"row",class:t.classes},[a("dt",{staticClass:"col-sm-3"},[t._v(" "+t._s(t.title)+" ")]),t.href.length>0?a("dd",{staticClass:"col-sm-9 mb-0",class:"text-"+t.variant},[t.href.length>0?a("b-link",{attrs:{href:t.href,target:"_blank",rel:"noopener noreferrer"}},[t._v(" "+t._s(t.data.length>0?t.data:t.number!==Number.MAX_VALUE?t.number:"")+" ")]):t._e()],1):t.click?a("dd",{staticClass:"col-sm-9 mb-0",class:"text-"+t.variant,on:{click:function(e){return t.$emit("click")}}},[a("b-link",[t._v(" "+t._s(t.data.length>0?t.data:t.number!==Number.MAX_VALUE?t.number:"")+" ")])],1):a("dd",{staticClass:"col-sm-9 mb-0",class:"text-"+t.variant},[t._v(" "+t._s(t.data.length>0?t.data:t.number!==Number.MAX_VALUE?t.number:"")+" ")])])},r=[],n=a(67347);const l={components:{BLink:n.we},props:{title:{type:String,required:!0},classes:{type:String,required:!1,default:"mb-1"},data:{type:String,required:!1,default:""},number:{type:Number,required:!1,default:Number.MAX_VALUE},variant:{type:String,required:!1,default:"secondary"},href:{type:String,required:!1,default:""},click:{type:Boolean,required:!1,default:!1}}},i=l;var o=a(1001),d=(0,o.Z)(i,s,r,!1,null,null,null);const c=d.exports},63005:(t,e,a)=>{a.r(e),a.d(e,{default:()=>n});const s={year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"},r={year:"numeric",month:"short",day:"numeric"},n={shortDate:s,date:r}},39569:(t,e,a)=>{a.d(e,{Z:()=>r});var s=a(80914);const r={start(t){return(0,s.Z)().get("/benchmark/start",{headers:{zelidauth:t}})},restart(t){return(0,s.Z)().get("/benchmark/restart",{headers:{zelidauth:t}})},getStatus(){return(0,s.Z)().get("/benchmark/getstatus")},restartNodeBenchmarks(t){return(0,s.Z)().get("/benchmark/restartnodebenchmarks",{headers:{zelidauth:t}})},signFluxTransaction(t,e){return(0,s.Z)().get(`/benchmark/signzelnodetransaction/${e}`,{headers:{zelidauth:t}})},helpSpecific(t){return(0,s.Z)().get(`/benchmark/help/${t}`)},help(){return(0,s.Z)().get("/benchmark/help")},stop(t){return(0,s.Z)().get("/benchmark/stop",{headers:{zelidauth:t}})},getBenchmarks(){return(0,s.Z)().get("/benchmark/getbenchmarks")},getInfo(){return(0,s.Z)().get("/benchmark/getinfo")},tailBenchmarkDebug(t){return(0,s.Z)().get("/flux/tailbenchmarkdebug",{headers:{zelidauth:t}})},justAPI(){return(0,s.Z)()},cancelToken(){return s.S}}}}]);