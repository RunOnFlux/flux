(globalThis["webpackChunkflux"]=globalThis["webpackChunkflux"]||[]).push([[5609],{87156:(e,n,a)=>{"use strict";a.d(n,{Z:()=>p});var o=function(){var e=this,n=e._self._c;return n("b-popover",{ref:"popover",attrs:{target:`${e.target}`,triggers:"click blur",show:e.show,placement:"auto",container:"my-container","custom-class":`confirm-dialog-${e.width}`},on:{"update:show":function(n){e.show=n}},scopedSlots:e._u([{key:"title",fn:function(){return[n("div",{staticClass:"d-flex justify-content-between align-items-center"},[n("span",[e._v(e._s(e.title))]),n("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"close",attrs:{variant:"transparent","aria-label":"Close"},on:{click:function(n){e.show=!1}}},[n("span",{staticClass:"d-inline-block text-white",attrs:{"aria-hidden":"true"}},[e._v("×")])])],1)]},proxy:!0}])},[n("div",{staticClass:"text-center"},[n("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],staticClass:"mr-1",attrs:{size:"sm",variant:"danger"},on:{click:function(n){e.show=!1}}},[e._v(" "+e._s(e.cancelButton)+" ")]),n("b-button",{directives:[{name:"ripple",rawName:"v-ripple.400",value:"rgba(255, 255, 255, 0.15)",expression:"'rgba(255, 255, 255, 0.15)'",modifiers:{400:!0}}],attrs:{size:"sm",variant:"primary"},on:{click:function(n){return e.confirm()}}},[e._v(" "+e._s(e.confirmButton)+" ")])],1)])},t=[],i=a(15193),d=a(53862),c=a(20266);const l={components:{BButton:i.T,BPopover:d.x},directives:{Ripple:c.Z},props:{target:{type:String,required:!0},title:{type:String,required:!1,default:"Are You Sure?"},cancelButton:{type:String,required:!1,default:"Cancel"},confirmButton:{type:String,required:!0},width:{type:Number,required:!1,default:300}},data(){return{show:!1}},methods:{confirm(){this.show=!1,this.$emit("confirm")}}},r=l;var s=a(1001),m=(0,s.Z)(r,o,t,!1,null,null,null);const p=m.exports},63005:(e,n,a)=>{"use strict";a.r(n),a.d(n,{default:()=>i});const o={year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"},t={year:"numeric",month:"short",day:"numeric"},i={shortDate:o,date:t}},5449:(e,n,a)=>{"use strict";a.d(n,{P:()=>d,Z:()=>c});var o=a(44866);const t={apiKey:"AIzaSyAtMsozWwJhhPIOd9BGkZxk5D6Wr8jVGVM",authDomain:"fluxcore-prod.firebaseapp.com",projectId:"fluxcore-prod",storageBucket:"fluxcore-prod.appspot.com",messagingSenderId:"468366888401",appId:"1:468366888401:web:56eb34ebe93751527ea4f0",measurementId:"G-SEGT3X2737"},i=o.Z.initializeApp(t);function d(){try{return i.auth().currentUser}catch(e){return null}}const c=i},57306:e=>{const n=[{name:"Afghanistan",dial_code:"+93",code:"AF",continent:"AS"},{name:"Aland Islands",dial_code:"+358",code:"AX"},{name:"Albania",dial_code:"+355",code:"AL",continent:"EU"},{name:"Algeria",dial_code:"+213",code:"DZ",continent:"AF"},{name:"American Samoa",dial_code:"+1684",code:"AS",continent:"OC"},{name:"Andorra",dial_code:"+376",code:"AD",continent:"EU"},{name:"Angola",dial_code:"+244",code:"AO",continent:"AF"},{name:"Anguilla",dial_code:"+1264",code:"AI",continent:"NA"},{name:"Antarctica",dial_code:"+672",code:"AQ",continent:"AN"},{name:"Antigua and Barbuda",dial_code:"+1268",code:"AG",continent:"NA"},{name:"Argentina",dial_code:"+54",code:"AR",continent:"SA"},{name:"Armenia",dial_code:"+374",code:"AM",continent:"AS"},{name:"Aruba",dial_code:"+297",code:"AW",continent:"NA"},{name:"Australia",dial_code:"+61",code:"AU",continent:"OC"},{name:"Austria",dial_code:"+43",code:"AT",continent:"EU"},{name:"Azerbaijan",dial_code:"+994",code:"AZ",continent:"AS"},{name:"Bahamas",dial_code:"+1242",code:"BS",continent:"NA"},{name:"Bahrain",dial_code:"+973",code:"BH",continent:"AS"},{name:"Bangladesh",dial_code:"+880",code:"BD",continent:"AS"},{name:"Barbados",dial_code:"+1246",code:"BB",continent:"NA"},{name:"Belarus",dial_code:"+375",code:"BY",continent:"EU"},{name:"Belgium",dial_code:"+32",code:"BE",continent:"EU"},{name:"Belize",dial_code:"+501",code:"BZ",continent:"NA"},{name:"Benin",dial_code:"+229",code:"BJ",continent:"AF"},{name:"Bermuda",dial_code:"+1441",code:"BM",continent:"NA"},{name:"Bhutan",dial_code:"+975",code:"BT",continent:"AS"},{name:"Bolivia, Plurinational State of",dial_code:"+591",code:"BO"},{name:"Bosnia and Herzegovina",dial_code:"+387",code:"BA",continent:"EU"},{name:"Botswana",dial_code:"+267",code:"BW",continent:"AF"},{name:"Brazil",dial_code:"+55",code:"BR",continent:"SA"},{name:"British Indian Ocean Territory",dial_code:"+246",code:"IO",continent:"AF"},{name:"Brunei Darussalam",dial_code:"+673",code:"BN"},{name:"Bulgaria",dial_code:"+359",code:"BG",continent:"EU"},{name:"Burkina Faso",dial_code:"+226",code:"BF",continent:"AF"},{name:"Burundi",dial_code:"+257",code:"BI",continent:"AF"},{name:"Cambodia",dial_code:"+855",code:"KH",continent:"AS"},{name:"Cameroon",dial_code:"+237",code:"CM",continent:"AF"},{name:"Canada",dial_code:"+1",code:"CA",available:!0,continent:"NA"},{name:"Cape Verde",dial_code:"+238",code:"CV",continent:"AF"},{name:"Cayman Islands",dial_code:"+ 345",code:"KY",continent:"NA"},{name:"Central African Republic",dial_code:"+236",code:"CF",continent:"AF"},{name:"Chad",dial_code:"+235",code:"TD",continent:"AF"},{name:"Chile",dial_code:"+56",code:"CL",continent:"SA"},{name:"China",dial_code:"+86",code:"CN",available:!0,continent:"AS"},{name:"Christmas Island",dial_code:"+61",code:"CX",continent:"OC"},{name:"Cocos (Keeling) Islands",dial_code:"+61",code:"CC",continent:"OC"},{name:"Colombia",dial_code:"+57",code:"CO",continent:"SA"},{name:"Comoros",dial_code:"+269",code:"KM",continent:"AF"},{name:"Congo",dial_code:"+242",code:"CG",continent:"AF"},{name:"Congo, The Democratic Republic of the Congo",dial_code:"+243",code:"CD"},{name:"Cook Islands",dial_code:"+682",code:"CK",continent:"OC"},{name:"Costa Rica",dial_code:"+506",code:"CR",continent:"NA"},{name:"Cote d'Ivoire",dial_code:"+225",code:"CI"},{name:"Croatia",dial_code:"+385",code:"HR",continent:"EU"},{name:"Cuba",dial_code:"+53",code:"CU",continent:"NA"},{name:"Cyprus",dial_code:"+357",code:"CY",continent:"AS"},{name:"Czech Republic",dial_code:"+420",code:"CZ",continent:"EU"},{name:"Denmark",dial_code:"+45",code:"DK",continent:"EU"},{name:"Djibouti",dial_code:"+253",code:"DJ",continent:"AF"},{name:"Dominica",dial_code:"+1767",code:"DM",continent:"NA"},{name:"Dominican Republic",dial_code:"+1849",code:"DO",continent:"NA"},{name:"Ecuador",dial_code:"+593",code:"EC",continent:"SA"},{name:"Egypt",dial_code:"+20",code:"EG",continent:"AF"},{name:"El Salvador",dial_code:"+503",code:"SV",continent:"NA"},{name:"Equatorial Guinea",dial_code:"+240",code:"GQ",continent:"AF"},{name:"Eritrea",dial_code:"+291",code:"ER",continent:"AF"},{name:"Estonia",dial_code:"+372",code:"EE",continent:"EU"},{name:"Ethiopia",dial_code:"+251",code:"ET",continent:"AF"},{name:"Falkland Islands (Malvinas)",dial_code:"+500",code:"FK"},{name:"Faroe Islands",dial_code:"+298",code:"FO",continent:"EU"},{name:"Fiji Islands",dial_code:"+679",code:"FJ",continent:"OC"},{name:"Finland",dial_code:"+358",code:"FI",available:!0,continent:"EU"},{name:"France",dial_code:"+33",code:"FR",available:!0,continent:"EU"},{name:"French Guiana",dial_code:"+594",code:"GF",continent:"SA"},{name:"French Polynesia",dial_code:"+689",code:"PF",continent:"OC"},{name:"Gabon",dial_code:"+241",code:"GA",continent:"AF"},{name:"Gambia",dial_code:"+220",code:"GM",continent:"AF"},{name:"Georgia",dial_code:"+995",code:"GE",continent:"AS"},{name:"Germany",dial_code:"+49",code:"DE",available:!0,continent:"EU"},{name:"Ghana",dial_code:"+233",code:"GH",continent:"AF"},{name:"Gibraltar",dial_code:"+350",code:"GI",continent:"EU"},{name:"Greece",dial_code:"+30",code:"GR",continent:"EU"},{name:"Greenland",dial_code:"+299",code:"GL",continent:"NA"},{name:"Grenada",dial_code:"+1473",code:"GD",continent:"NA"},{name:"Guadeloupe",dial_code:"+590",code:"GP",continent:"NA"},{name:"Guam",dial_code:"+1671",code:"GU",continent:"OC"},{name:"Guatemala",dial_code:"+502",code:"GT",continent:"NA"},{name:"Guernsey",dial_code:"+44",code:"GG"},{name:"Guinea",dial_code:"+224",code:"GN",continent:"AF"},{name:"Guinea-Bissau",dial_code:"+245",code:"GW",continent:"AF"},{name:"Guyana",dial_code:"+595",code:"GY",continent:"SA"},{name:"Haiti",dial_code:"+509",code:"HT",continent:"NA"},{name:"Holy See (Vatican City State)",dial_code:"+379",code:"VA",continent:"EU"},{name:"Honduras",dial_code:"+504",code:"HN",continent:"NA"},{name:"Hong Kong",dial_code:"+852",code:"HK",continent:"AS"},{name:"Hungary",dial_code:"+36",code:"HU",continent:"EU"},{name:"Iceland",dial_code:"+354",code:"IS",continent:"EU"},{name:"India",dial_code:"+91",code:"IN",continent:"AS"},{name:"Indonesia",dial_code:"+62",code:"ID",continent:"AS"},{name:"Iran",dial_code:"+98",code:"IR",continent:"AS"},{name:"Iraq",dial_code:"+964",code:"IQ",continent:"AS"},{name:"Ireland",dial_code:"+353",code:"IE",continent:"EU"},{name:"Isle of Man",dial_code:"+44",code:"IM"},{name:"Israel",dial_code:"+972",code:"IL",continent:"AS"},{name:"Italy",dial_code:"+39",code:"IT",continent:"EU"},{name:"Jamaica",dial_code:"+1876",code:"JM",continent:"NA"},{name:"Japan",dial_code:"+81",code:"JP",continent:"AS"},{name:"Jersey",dial_code:"+44",code:"JE"},{name:"Jordan",dial_code:"+962",code:"JO",continent:"AS"},{name:"Kazakhstan",dial_code:"+77",code:"KZ",continent:"AS"},{name:"Kenya",dial_code:"+254",code:"KE",continent:"AF"},{name:"Kiribati",dial_code:"+686",code:"KI",continent:"OC"},{name:"North Korea",dial_code:"+850",code:"KP",continent:"AS"},{name:"South Korea",dial_code:"+82",code:"KR",continent:"AS"},{name:"Kuwait",dial_code:"+965",code:"KW",continent:"AS"},{name:"Kyrgyzstan",dial_code:"+996",code:"KG",continent:"AS"},{name:"Laos",dial_code:"+856",code:"LA",continent:"AS"},{name:"Latvia",dial_code:"+371",code:"LV",continent:"EU"},{name:"Lebanon",dial_code:"+961",code:"LB",continent:"AS"},{name:"Lesotho",dial_code:"+266",code:"LS",continent:"AF"},{name:"Liberia",dial_code:"+231",code:"LR",continent:"AF"},{name:"Libyan Arab Jamahiriya",dial_code:"+218",code:"LY",continent:"AF"},{name:"Liechtenstein",dial_code:"+423",code:"LI",continent:"EU"},{name:"Lithuania",dial_code:"+370",code:"LT",available:!0,continent:"EU"},{name:"Luxembourg",dial_code:"+352",code:"LU",continent:"EU"},{name:"Macao",dial_code:"+853",code:"MO",continent:"AS"},{name:"Macedonia",dial_code:"+389",code:"MK",continent:"EU"},{name:"Madagascar",dial_code:"+261",code:"MG",continent:"AF"},{name:"Malawi",dial_code:"+265",code:"MW",continent:"AF"},{name:"Malaysia",dial_code:"+60",code:"MY",continent:"AS"},{name:"Maldives",dial_code:"+960",code:"MV",continent:"AS"},{name:"Mali",dial_code:"+223",code:"ML",continent:"AF"},{name:"Malta",dial_code:"+356",code:"MT",continent:"EU"},{name:"Marshall Islands",dial_code:"+692",code:"MH",continent:"OC"},{name:"Martinique",dial_code:"+596",code:"MQ",continent:"NA"},{name:"Mauritania",dial_code:"+222",code:"MR",continent:"AF"},{name:"Mauritius",dial_code:"+230",code:"MU",continent:"AF"},{name:"Mayotte",dial_code:"+262",code:"YT",continent:"AF"},{name:"Mexico",dial_code:"+52",code:"MX",continent:"NA"},{name:"Micronesia, Federated States of Micronesia",dial_code:"+691",code:"FM",continent:"OC"},{name:"Moldova",dial_code:"+373",code:"MD",continent:"EU"},{name:"Monaco",dial_code:"+377",code:"MC",continent:"EU"},{name:"Mongolia",dial_code:"+976",code:"MN",continent:"AS"},{name:"Montenegro",dial_code:"+382",code:"ME",continent:"EU"},{name:"Montserrat",dial_code:"+1664",code:"MS",continent:"NA"},{name:"Morocco",dial_code:"+212",code:"MA",continent:"AF"},{name:"Mozambique",dial_code:"+258",code:"MZ",continent:"AF"},{name:"Myanmar",dial_code:"+95",code:"MM",continent:"AS"},{name:"Namibia",dial_code:"+264",code:"NA",continent:"AF"},{name:"Nauru",dial_code:"+674",code:"NR",continent:"OC"},{name:"Nepal",dial_code:"+977",code:"NP",continent:"AS"},{name:"Netherlands",dial_code:"+31",code:"NL",available:!0,continent:"EU"},{name:"Netherlands Antilles",dial_code:"+599",code:"AN",continent:"NA"},{name:"New Caledonia",dial_code:"+687",code:"NC",continent:"OC"},{name:"New Zealand",dial_code:"+64",code:"NZ",continent:"OC"},{name:"Nicaragua",dial_code:"+505",code:"NI",continent:"NA"},{name:"Niger",dial_code:"+227",code:"NE",continent:"AF"},{name:"Nigeria",dial_code:"+234",code:"NG",continent:"AF"},{name:"Niue",dial_code:"+683",code:"NU",continent:"OC"},{name:"Norfolk Island",dial_code:"+672",code:"NF",continent:"OC"},{name:"Northern Mariana Islands",dial_code:"+1670",code:"MP",continent:"OC"},{name:"Norway",dial_code:"+47",code:"NO",continent:"EU"},{name:"Oman",dial_code:"+968",code:"OM",continent:"AS"},{name:"Pakistan",dial_code:"+92",code:"PK",continent:"AS"},{name:"Palau",dial_code:"+680",code:"PW",continent:"OC"},{name:"Palestinian Territory, Occupied",dial_code:"+970",code:"PS"},{name:"Panama",dial_code:"+507",code:"PA",continent:"NA"},{name:"Papua New Guinea",dial_code:"+675",code:"PG",continent:"OC"},{name:"Paraguay",dial_code:"+595",code:"PY",continent:"SA"},{name:"Peru",dial_code:"+51",code:"PE",continent:"SA"},{name:"Philippines",dial_code:"+63",code:"PH",continent:"AS"},{name:"Pitcairn",dial_code:"+872",code:"PN",continent:"OC"},{name:"Poland",dial_code:"+48",code:"PL",available:!0,continent:"EU"},{name:"Portugal",dial_code:"+351",code:"PT",available:!0,continent:"EU"},{name:"Puerto Rico",dial_code:"+1939",code:"PR",continent:"NA"},{name:"Qatar",dial_code:"+974",code:"QA",continent:"AS"},{name:"Romania",dial_code:"+40",code:"RO",continent:"EU"},{name:"Russia",dial_code:"+7",code:"RU",available:!0,continent:"EU"},{name:"Rwanda",dial_code:"+250",code:"RW",continent:"AF"},{name:"Reunion",dial_code:"+262",code:"RE",continent:"AF"},{name:"Saint Barthelemy",dial_code:"+590",code:"BL"},{name:"Saint Helena",dial_code:"+290",code:"SH",continent:"AF"},{name:"Saint Kitts and Nevis",dial_code:"+1869",code:"KN",continent:"NA"},{name:"Saint Lucia",dial_code:"+1758",code:"LC",continent:"NA"},{name:"Saint Martin",dial_code:"+590",code:"MF"},{name:"Saint Pierre and Miquelon",dial_code:"+508",code:"PM",continent:"NA"},{name:"Saint Vincent and the Grenadines",dial_code:"+1784",code:"VC",continent:"NA"},{name:"Samoa",dial_code:"+685",code:"WS",continent:"OC"},{name:"San Marino",dial_code:"+378",code:"SM",continent:"EU"},{name:"Sao Tome and Principe",dial_code:"+239",code:"ST",continent:"AF"},{name:"Saudi Arabia",dial_code:"+966",code:"SA",continent:"AS"},{name:"Senegal",dial_code:"+221",code:"SN",continent:"AF"},{name:"Serbia",dial_code:"+381",code:"RS",continent:"EU"},{name:"Seychelles",dial_code:"+248",code:"SC",continent:"AF"},{name:"Sierra Leone",dial_code:"+232",code:"SL",continent:"AF"},{name:"Singapore",dial_code:"+65",code:"SG",continent:"AS"},{name:"Slovakia",dial_code:"+421",code:"SK",continent:"EU"},{name:"Slovenia",dial_code:"+386",code:"SI",available:!0,continent:"EU"},{name:"Solomon Islands",dial_code:"+677",code:"SB",continent:"OC"},{name:"Somalia",dial_code:"+252",code:"SO",continent:"AF"},{name:"South Africa",dial_code:"+27",code:"ZA",continent:"AF"},{name:"South Sudan",dial_code:"+211",code:"SS",continent:"AF"},{name:"South Georgia and the South Sandwich Islands",dial_code:"+500",code:"GS",continent:"AN"},{name:"Spain",dial_code:"+34",code:"ES",available:!0,continent:"EU"},{name:"Sri Lanka",dial_code:"+94",code:"LK",continent:"AS"},{name:"Sudan",dial_code:"+249",code:"SD",continent:"AF"},{name:"Suriname",dial_code:"+597",code:"SR",continent:"SA"},{name:"Svalbard and Jan Mayen",dial_code:"+47",code:"SJ",continent:"EU"},{name:"Swaziland",dial_code:"+268",code:"SZ",continent:"AF"},{name:"Sweden",dial_code:"+46",code:"SE",continent:"EU"},{name:"Switzerland",dial_code:"+41",code:"CH",continent:"EU"},{name:"Syrian Arab Republic",dial_code:"+963",code:"SY"},{name:"Taiwan",dial_code:"+886",code:"TW"},{name:"Tajikistan",dial_code:"+992",code:"TJ",continent:"AS"},{name:"Tanzania, United Republic of Tanzania",dial_code:"+255",code:"TZ"},{name:"Thailand",dial_code:"+66",code:"TH",continent:"AS"},{name:"Timor-Leste",dial_code:"+670",code:"TL"},{name:"Togo",dial_code:"+228",code:"TG",continent:"AF"},{name:"Tokelau",dial_code:"+690",code:"TK",continent:"OC"},{name:"Tonga",dial_code:"+676",code:"TO",continent:"OC"},{name:"Trinidad and Tobago",dial_code:"+1868",code:"TT",continent:"NA"},{name:"Tunisia",dial_code:"+216",code:"TN",continent:"AF"},{name:"Turkey",dial_code:"+90",code:"TR",continent:"AS"},{name:"Turkmenistan",dial_code:"+993",code:"TM",continent:"AS"},{name:"Turks and Caicos Islands",dial_code:"+1649",code:"TC",continent:"NA"},{name:"Tuvalu",dial_code:"+688",code:"TV",continent:"OC"},{name:"Uganda",dial_code:"+256",code:"UG",continent:"AF"},{name:"Ukraine",dial_code:"+380",code:"UA",continent:"EU"},{name:"United Arab Emirates",dial_code:"+971",code:"AE",continent:"AS"},{name:"United Kingdom",dial_code:"+44",code:"GB",available:!0,continent:"EU"},{name:"United States",dial_code:"+1",code:"US",available:!0,continent:"NA"},{name:"Uruguay",dial_code:"+598",code:"UY",continent:"SA"},{name:"Uzbekistan",dial_code:"+998",code:"UZ",continent:"AS"},{name:"Vanuatu",dial_code:"+678",code:"VU",continent:"OC"},{name:"Venezuela, Bolivarian Republic of Venezuela",dial_code:"+58",code:"VE"},{name:"Vietnam",dial_code:"+84",code:"VN",continent:"AS"},{name:"Virgin Islands, British",dial_code:"+1284",code:"VG",continent:"NA"},{name:"Virgin Islands, U.S.",dial_code:"+1340",code:"VI",continent:"NA"},{name:"Wallis and Futuna",dial_code:"+681",code:"WF",continent:"OC"},{name:"Yemen",dial_code:"+967",code:"YE",continent:"AS"},{name:"Zambia",dial_code:"+260",code:"ZM",continent:"AF"},{name:"Zimbabwe",dial_code:"+263",code:"ZW",continent:"AF"}],a=[{name:"Africa",code:"AF"},{name:"North America",code:"NA",available:!0},{name:"Oceania",code:"OC",available:!0},{name:"Asia",code:"AS",available:!0},{name:"Europe",code:"EU",available:!0},{name:"South America",code:"SA"},{name:"Antarctica",code:"AN"}];e.exports={countries:n,continents:a}},43672:(e,n,a)=>{"use strict";a.d(n,{Z:()=>t});var o=a(80914);const t={listRunningApps(){const e={headers:{"x-apicache-bypass":!0}};return(0,o.Z)().get("/apps/listrunningapps",e)},listAllApps(){const e={headers:{"x-apicache-bypass":!0}};return(0,o.Z)().get("/apps/listallapps",e)},installedApps(){const e={headers:{"x-apicache-bypass":!0}};return(0,o.Z)().get("/apps/installedapps",e)},availableApps(){return(0,o.Z)().get("/apps/availableapps")},getEnterpriseNodes(){return(0,o.Z)().get("/apps/enterprisenodes")},stopApp(e,n){const a={headers:{zelidauth:e,"x-apicache-bypass":!0}};return(0,o.Z)().get(`/apps/appstop/${n}`,a)},startApp(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().get(`/apps/appstart/${n}`,a)},pauseApp(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().get(`/apps/apppause/${n}`,a)},unpauseApp(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().get(`/apps/appunpause/${n}`,a)},restartApp(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().get(`/apps/apprestart/${n}`,a)},removeApp(e,n){const a={headers:{zelidauth:e},onDownloadProgress(e){console.log(e)}};return(0,o.Z)().get(`/apps/appremove/${n}`,a)},registerApp(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().post("/apps/appregister",JSON.stringify(n),a)},updateApp(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().post("/apps/appupdate",JSON.stringify(n),a)},checkCommunication(){return(0,o.Z)().get("/flux/checkcommunication")},checkDockerExistance(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().post("/apps/checkdockerexistance",JSON.stringify(n),a)},appsRegInformation(){return(0,o.Z)().get("/apps/registrationinformation")},appsDeploymentInformation(){return(0,o.Z)().get("/apps/deploymentinformation")},getAppLocation(e){return(0,o.Z)().get(`/apps/location/${e}`)},globalAppSpecifications(){return(0,o.Z)().get("/apps/globalappsspecifications")},permanentMessagesOwner(e){return(0,o.Z)().get(`/apps/permanentmessages?owner=${e}`)},getInstalledAppSpecifics(e){return(0,o.Z)().get(`/apps/installedapps/${e}`)},getAppSpecifics(e){return(0,o.Z)().get(`/apps/appspecifications/${e}`)},getAppOwner(e){return(0,o.Z)().get(`/apps/appowner/${e}`)},getAppLogsTail(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().get(`/apps/applog/${n}/100`,a)},getAppTop(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().get(`/apps/apptop/${n}`,a)},getAppInspect(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().get(`/apps/appinspect/${n}`,a)},getAppStats(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().get(`/apps/appstats/${n}`,a)},getAppChanges(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().get(`/apps/appchanges/${n}`,a)},getAppExec(e,n,a,t){const i={headers:{zelidauth:e}},d={appname:n,cmd:a,env:JSON.parse(t)};return(0,o.Z)().post("/apps/appexec",JSON.stringify(d),i)},reindexGlobalApps(e){return(0,o.Z)().get("/apps/reindexglobalappsinformation",{headers:{zelidauth:e}})},reindexLocations(e){return(0,o.Z)().get("/apps/reindexglobalappslocation",{headers:{zelidauth:e}})},rescanGlobalApps(e,n,a){return(0,o.Z)().get(`/apps/rescanglobalappsinformation/${n}/${a}`,{headers:{zelidauth:e}})},getFolder(e,n){return(0,o.Z)().get(`/apps/fluxshare/getfolder/${n}`,{headers:{zelidauth:e}})},createFolder(e,n){return(0,o.Z)().get(`/apps/fluxshare/createfolder/${n}`,{headers:{zelidauth:e}})},getFile(e,n){return(0,o.Z)().get(`/apps/fluxshare/getfile/${n}`,{headers:{zelidauth:e}})},removeFile(e,n){return(0,o.Z)().get(`/apps/fluxshare/removefile/${n}`,{headers:{zelidauth:e}})},shareFile(e,n){return(0,o.Z)().get(`/apps/fluxshare/sharefile/${n}`,{headers:{zelidauth:e}})},unshareFile(e,n){return(0,o.Z)().get(`/apps/fluxshare/unsharefile/${n}`,{headers:{zelidauth:e}})},removeFolder(e,n){return(0,o.Z)().get(`/apps/fluxshare/removefolder/${n}`,{headers:{zelidauth:e}})},fileExists(e,n){return(0,o.Z)().get(`/apps/fluxshare/fileexists/${n}`,{headers:{zelidauth:e}})},storageStats(e){return(0,o.Z)().get("/apps/fluxshare/stats",{headers:{zelidauth:e}})},renameFileFolder(e,n,a){return(0,o.Z)().get(`/apps/fluxshare/rename/${n}/${a}`,{headers:{zelidauth:e}})},appPrice(e){return(0,o.Z)().post("/apps/calculateprice",JSON.stringify(e))},appPriceUSDandFlux(e){return(0,o.Z)().post("/apps/calculatefiatandfluxprice",JSON.stringify(e))},appRegistrationVerificaiton(e){return(0,o.Z)().post("/apps/verifyappregistrationspecifications",JSON.stringify(e))},appUpdateVerification(e){return(0,o.Z)().post("/apps/verifyappupdatespecifications",JSON.stringify(e))},getAppMonitoring(e,n){const a={headers:{zelidauth:e}};return(0,o.Z)().get(`/apps/appmonitor/${n}`,a)},startAppMonitoring(e,n){const a={headers:{zelidauth:e}};return n?(0,o.Z)().get(`/apps/startmonitoring/${n}`,a):(0,o.Z)().get("/apps/startmonitoring",a)},stopAppMonitoring(e,n,a){const t={headers:{zelidauth:e}};return n&&a?(0,o.Z)().get(`/apps/stopmonitoring/${n}/${a}`,t):n?(0,o.Z)().get(`/apps/stopmonitoring/${n}`,t):a?(0,o.Z)().get(`/apps/stopmonitoring?deletedata=${a}`,t):(0,o.Z)().get("/apps/stopmonitoring",t)},justAPI(){return(0,o.Z)()}}},20134:(e,n,a)=>{"use strict";e.exports=a.p+"img/Stripe.svg"},36547:(e,n,a)=>{"use strict";e.exports=a.p+"img/PayPal.png"}}]);