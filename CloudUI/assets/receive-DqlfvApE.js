import{c as g,r as v,e as $,a as k,i as x,x as l,l as c,m as w,A as m,U as C,o as h,p as N,W as R,R as A,q as S}from"./crypto-walletconnect-BoPpUqP0.js";import{n as y,r as f}from"./index-D_zm-K7P.js";import{o as I}from"./if-defined-6m10w9Qt.js";import"./index-CV0VcXMx.js";import"./index-DUgrMXIz.js";import"./crypto-metamask-FwTrKlAT.js";import"./monaco-D0sk5loy.js";import"./vuetify-COByHKRY.js";import"./leaflet-core-BkStxytj.js";const T=g`
  button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${({spacing:e})=>e[4]};
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-radius: ${({borderRadius:e})=>e[3]};
    border: none;
    padding: ${({spacing:e})=>e[3]};
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color;
  }

  /* -- Hover & Active states ----------------------------------------------------------- */
  button:hover:enabled,
  button:active:enabled {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  wui-text {
    flex: 1;
    color: ${({tokens:e})=>e.theme.textSecondary};
  }

  wui-flex {
    width: auto;
    display: flex;
    align-items: center;
    gap: ${({spacing:e})=>e["01"]};
  }

  wui-icon {
    color: ${({tokens:e})=>e.theme.iconDefault};
  }

  .network-icon {
    position: relative;
    width: 20px;
    height: 20px;
    border-radius: ${({borderRadius:e})=>e[4]};
    overflow: hidden;
    margin-left: -8px;
  }

  .network-icon:first-child {
    margin-left: 0px;
  }

  .network-icon:after {
    position: absolute;
    inset: 0;
    content: '';
    display: block;
    height: 100%;
    width: 100%;
    border-radius: ${({borderRadius:e})=>e[4]};
    box-shadow: inset 0 0 0 1px ${({tokens:e})=>e.core.glass010};
  }
`;var b=function(e,t,o,r){var s=arguments.length,i=s<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,o):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(e,t,o,r);else for(var a=e.length-1;a>=0;a--)(n=e[a])&&(i=(s<3?n(i):s>3?n(t,o,i):n(t,o))||i);return s>3&&i&&Object.defineProperty(t,o,i),i};let d=class extends x{constructor(){super(...arguments),this.networkImages=[""],this.text=""}render(){return l`
      <button>
        <wui-text variant="md-regular" color="inherit">${this.text}</wui-text>
        <wui-flex>
          ${this.networksTemplate()}
          <wui-icon name="chevronRight" size="sm" color="inherit"></wui-icon>
        </wui-flex>
      </button>
    `}networksTemplate(){const t=this.networkImages.slice(0,5);return l` <wui-flex class="networks">
      ${t?.map(o=>l` <wui-flex class="network-icon"> <wui-image src=${o}></wui-image> </wui-flex>`)}
    </wui-flex>`}};d.styles=[v,$,T];b([y({type:Array})],d.prototype,"networkImages",void 0);b([y()],d.prototype,"text",void 0);d=b([k("wui-compatible-network")],d);const O=g`
  wui-compatible-network {
    margin-top: ${({spacing:e})=>e[4]};
    width: 100%;
  }

  wui-qr-code {
    width: unset !important;
    height: unset !important;
  }

  wui-icon {
    align-items: normal;
  }
`;var p=function(e,t,o,r){var s=arguments.length,i=s<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,o):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(e,t,o,r);else for(var a=e.length-1;a>=0;a--)(n=e[a])&&(i=(s<3?n(i):s>3?n(t,o,i):n(t,o))||i);return s>3&&i&&Object.defineProperty(t,o,i),i};let u=class extends x{constructor(){super(),this.unsubscribe=[],this.address=c.getAccountData()?.address,this.profileName=c.getAccountData()?.profileName,this.network=c.state.activeCaipNetwork,this.unsubscribe.push(c.subscribeChainProp("accountState",t=>{t?(this.address=t.address,this.profileName=t.profileName):w.showError("Account not found")}),c.subscribeKey("activeCaipNetwork",t=>{t?.id&&(this.network=t)}))}disconnectedCallback(){this.unsubscribe.forEach(t=>t())}render(){if(!this.address)throw new Error("w3m-wallet-receive-view: No account provided");const t=m.getNetworkImage(this.network);return l` <wui-flex
      flexDirection="column"
      .padding=${["0","4","4","4"]}
      alignItems="center"
    >
      <wui-chip-button
        data-testid="receive-address-copy-button"
        @click=${this.onCopyClick.bind(this)}
        text=${C.getTruncateString({string:this.profileName||this.address||"",charsStart:this.profileName?18:4,charsEnd:this.profileName?0:4,truncate:this.profileName?"end":"middle"})}
        icon="copy"
        size="sm"
        imageSrc=${t||""}
        variant="gray"
      ></wui-chip-button>
      <wui-flex
        flexDirection="column"
        .padding=${["4","0","0","0"]}
        alignItems="center"
        gap="4"
      >
        <wui-qr-code
          size=${232}
          theme=${h.state.themeMode}
          uri=${this.address}
          ?arenaClear=${!0}
          color=${I(h.state.themeVariables["--apkt-qr-color"]??h.state.themeVariables["--w3m-qr-color"])}
          data-testid="wui-qr-code"
        ></wui-qr-code>
        <wui-text variant="lg-regular" color="primary" align="center">
          Copy your address or scan this QR code
        </wui-text>
        <wui-button @click=${this.onCopyClick.bind(this)} size="sm" variant="neutral-secondary">
          <wui-icon slot="iconLeft" size="sm" color="inherit" name="copy"></wui-icon>
          <wui-text variant="md-regular" color="inherit">Copy address</wui-text>
        </wui-button>
      </wui-flex>
      ${this.networkTemplate()}
    </wui-flex>`}networkTemplate(){const t=c.getAllRequestedCaipNetworks(),o=c.checkIfSmartAccountEnabled(),r=c.state.activeCaipNetwork,s=t.filter(a=>a?.chainNamespace===r?.chainNamespace);if(N(r?.chainNamespace)===R.ACCOUNT_TYPES.SMART_ACCOUNT&&o)return r?l`<wui-compatible-network
        @click=${this.onReceiveClick.bind(this)}
        text="Only receive assets on this network"
        .networkImages=${[m.getNetworkImage(r)??""]}
      ></wui-compatible-network>`:null;const n=(s?.filter(a=>a?.assets?.imageId)?.slice(0,5)).map(m.getNetworkImage).filter(Boolean);return l`<wui-compatible-network
      @click=${this.onReceiveClick.bind(this)}
      text="Only receive assets on these networks"
      .networkImages=${n}
    ></wui-compatible-network>`}onReceiveClick(){A.push("WalletCompatibleNetworks")}onCopyClick(){try{this.address&&(S.copyToClopboard(this.address),w.showSuccess("Address copied"))}catch{w.showError("Failed to copy")}}};u.styles=O;p([f()],u.prototype,"address",void 0);p([f()],u.prototype,"profileName",void 0);p([f()],u.prototype,"network",void 0);u=p([k("w3m-wallet-receive-view")],u);export{u as W3mWalletReceiveView};
