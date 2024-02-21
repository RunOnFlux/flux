"use strict";(globalThis["webpackChunkflux"]=globalThis["webpackChunkflux"]||[]).push([[6518],{34547:(t,e,a)=>{a.d(e,{Z:()=>p});var r=function(){var t=this,e=t._self._c;return e("div",{staticClass:"toastification"},[e("div",{staticClass:"d-flex align-items-start"},[e("b-avatar",{staticClass:"mr-75 flex-shrink-0",attrs:{variant:t.variant,size:"1.8rem"}},[e("feather-icon",{attrs:{icon:t.icon,size:"15"}})],1),e("div",{staticClass:"d-flex flex-grow-1"},[e("div",[t.title?e("h5",{staticClass:"mb-0 font-weight-bolder toastification-title",class:`text-${t.variant}`,domProps:{textContent:t._s(t.title)}}):t._e(),t.text?e("small",{staticClass:"d-inline-block text-body",domProps:{textContent:t._s(t.text)}}):t._e()]),e("span",{staticClass:"cursor-pointer toastification-close-icon ml-auto",on:{click:function(e){return t.$emit("close-toast")}}},[t.hideClose?t._e():e("feather-icon",{staticClass:"text-body",attrs:{icon:"XIcon"}})],1)])],1)])},n=[],o=a(47389);const s={components:{BAvatar:o.SH},props:{variant:{type:String,default:"primary"},icon:{type:String,default:null},title:{type:String,default:null},text:{type:String,default:null},hideClose:{type:Boolean,default:!1}}},i=s;var l=a(1001),c=(0,l.Z)(i,r,n,!1,null,"22d964ca",null);const p=c.exports},36518:(t,e,a)=>{a.r(e),a.d(e,{default:()=>g});var r=function(){var t=this,e=t._self._c;return e("b-card",[e("div",[e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"ml-1",attrs:{id:"stop-benchmark",variant:"outline-primary",size:"md"}},[t._v(" Stop Benchmark ")]),e("b-popover",{ref:"popover",attrs:{target:"stop-benchmark",triggers:"click",show:t.popoverShow,placement:"auto",container:"my-container"},on:{"update:show":function(e){t.popoverShow=e}},scopedSlots:t._u([{key:"title",fn:function(){return[e("div",{staticClass:"d-flex justify-content-between align-items-center"},[e("span",[t._v("Are You Sure?")]),e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"close",attrs:{variant:"transparent","aria-label":"Close"},on:{click:t.onClose}},[e("span",{staticClass:"d-inline-block text-white",attrs:{"aria-hidden":"true"}},[t._v("×")])])],1)]},proxy:!0}])},[e("div",[e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mr-1",attrs:{size:"sm",variant:"danger"},on:{click:t.onClose}},[t._v(" Cancel ")]),e("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],attrs:{size:"sm",variant:"primary"},on:{click:t.onOk}},[t._v(" Stop Benchmark ")])],1)]),e("b-modal",{attrs:{id:"modal-center",centered:"",title:"Benchmark Stop","ok-only":"","ok-title":"OK"},model:{value:t.modalShow,callback:function(e){t.modalShow=e},expression:"modalShow"}},[e("b-card-text",[t._v(" The benchmark will now stop. ")])],1)],1)])},n=[],o=a(86855),s=a(15193),i=a(53862),l=a(31220),c=a(64206),p=a(34547),d=a(20266),u=a(39569);const h={components:{BCard:o._,BButton:s.T,BPopover:i.x,BModal:l.N,BCardText:c.j,ToastificationContent:p.Z},directives:{Ripple:d.Z},data(){return{popoverShow:!1,modalShow:!1}},methods:{onClose(){this.popoverShow=!1},onOk(){this.popoverShow=!1,this.modalShow=!0;const t=localStorage.getItem("zelidauth");u.Z.stop(t).then((t=>{this.$toast({component:p.Z,props:{title:t.data.data.message||t.data.data,icon:"InfoIcon",variant:"success"}})})).catch((()=>{this.$toast({component:p.Z,props:{title:"Error while trying to stop Benchmark",icon:"InfoIcon",variant:"danger"}})}))}}},m=h;var v=a(1001),b=(0,v.Z)(m,r,n,!1,null,null,null);const g=b.exports},39569:(t,e,a)=>{a.d(e,{Z:()=>n});var r=a(80914);const n={start(t){return(0,r.Z)().get("/benchmark/start",{headers:{zelidauth:t}})},restart(t){return(0,r.Z)().get("/benchmark/restart",{headers:{zelidauth:t}})},getStatus(){return(0,r.Z)().get("/benchmark/getstatus")},restartNodeBenchmarks(t){return(0,r.Z)().get("/benchmark/restartnodebenchmarks",{headers:{zelidauth:t}})},signFluxTransaction(t,e){return(0,r.Z)().get(`/benchmark/signzelnodetransaction/${e}`,{headers:{zelidauth:t}})},helpSpecific(t){return(0,r.Z)().get(`/benchmark/help/${t}`)},help(){return(0,r.Z)().get("/benchmark/help")},stop(t){return(0,r.Z)().get("/benchmark/stop",{headers:{zelidauth:t}})},getBenchmarks(){return(0,r.Z)().get("/benchmark/getbenchmarks")},getInfo(){return(0,r.Z)().get("/benchmark/getinfo")},tailBenchmarkDebug(t){return(0,r.Z)().get("/flux/tailbenchmarkdebug",{headers:{zelidauth:t}})},justAPI(){return(0,r.Z)()},cancelToken(){return r.S}}}}]);