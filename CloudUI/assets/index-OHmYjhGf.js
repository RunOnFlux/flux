import{O as $,$ as b,q as _,l as d,k as E,a0 as B,G as w,a1 as j,a2 as q,t as P,m as C,R as L,M as x,a3 as z,a4 as X,b as W,i as F,x as m,a as H,o as J,u as M,A as Z}from"./crypto-walletconnect-BoPpUqP0.js";import{r as h}from"./index-D_zm-K7P.js";import{o as G}from"./if-defined-6m10w9Qt.js";import"./index-JCPEDFAS.js";import"./index-YBjINvSu.js";import"./index-DRV-Cm6-.js";import"./index-CV0VcXMx.js";import"./index-BdOHXo6q.js";import"./index-DFl_BNpm.js";import"./index-DpcsMR89.js";import"./index-DbWPKNxz.js";import"./index-BVY9HFSL.js";import"./index-DzcP5YIc.js";import"./crypto-metamask-FwTrKlAT.js";import"./monaco-D0sk5loy.js";import"./vuetify-COByHKRY.js";import"./leaflet-core-BkStxytj.js";import"./index-D1jicTFt.js";const i={INVALID_PAYMENT_CONFIG:"INVALID_PAYMENT_CONFIG",INVALID_RECIPIENT:"INVALID_RECIPIENT",INVALID_ASSET:"INVALID_ASSET",INVALID_AMOUNT:"INVALID_AMOUNT",UNKNOWN_ERROR:"UNKNOWN_ERROR",UNABLE_TO_INITIATE_PAYMENT:"UNABLE_TO_INITIATE_PAYMENT",INVALID_CHAIN_NAMESPACE:"INVALID_CHAIN_NAMESPACE",GENERIC_PAYMENT_ERROR:"GENERIC_PAYMENT_ERROR",UNABLE_TO_GET_EXCHANGES:"UNABLE_TO_GET_EXCHANGES",ASSET_NOT_SUPPORTED:"ASSET_NOT_SUPPORTED",UNABLE_TO_GET_PAY_URL:"UNABLE_TO_GET_PAY_URL",UNABLE_TO_GET_BUY_STATUS:"UNABLE_TO_GET_BUY_STATUS"},A={[i.INVALID_PAYMENT_CONFIG]:"Invalid payment configuration",[i.INVALID_RECIPIENT]:"Invalid recipient address",[i.INVALID_ASSET]:"Invalid asset specified",[i.INVALID_AMOUNT]:"Invalid payment amount",[i.UNKNOWN_ERROR]:"Unknown payment error occurred",[i.UNABLE_TO_INITIATE_PAYMENT]:"Unable to initiate payment",[i.INVALID_CHAIN_NAMESPACE]:"Invalid chain namespace",[i.GENERIC_PAYMENT_ERROR]:"Unable to process payment",[i.UNABLE_TO_GET_EXCHANGES]:"Unable to get exchanges",[i.ASSET_NOT_SUPPORTED]:"Asset not supported by the selected exchange",[i.UNABLE_TO_GET_PAY_URL]:"Unable to get payment URL",[i.UNABLE_TO_GET_BUY_STATUS]:"Unable to get buy status"};class c extends Error{get message(){return A[this.code]}constructor(e,a){super(A[e]),this.name="AppKitPayError",this.code=e,this.details=a,Error.captureStackTrace&&Error.captureStackTrace(this,c)}}const Q="https://rpc.walletconnect.org/v1/json-rpc";class ee extends Error{}function te(){const n=$.getSnapshot().projectId;return`${Q}?projectId=${n}`}async function O(n,e){const a=te(),{sdkType:s,sdkVersion:r,projectId:o}=$.getSnapshot(),u={jsonrpc:"2.0",id:1,method:n,params:{...e||{},st:s,sv:r,projectId:o}},g=await(await fetch(a,{method:"POST",body:JSON.stringify(u),headers:{"Content-Type":"application/json"}})).json();if(g.error)throw new ee(g.error.message);return g}async function Y(n){return(await O("reown_getExchanges",n)).result}async function ne(n){return(await O("reown_getExchangePayUrl",n)).result}async function ae(n){return(await O("reown_getExchangeBuyStatus",n)).result}const se=["eip155","solana"],re={eip155:{native:{assetNamespace:"slip44",assetReference:"60"},defaultTokenNamespace:"erc20"},solana:{native:{assetNamespace:"slip44",assetReference:"501"},defaultTokenNamespace:"token"}};function v(n,e){const{chainNamespace:a,chainId:s}=b.parseCaipNetworkId(n),r=re[a];if(!r)throw new Error(`Unsupported chain namespace for CAIP-19 formatting: ${a}`);let o=r.native.assetNamespace,u=r.native.assetReference;return e!=="native"&&(o=r.defaultTokenNamespace,u=e),`${`${a}:${s}`}/${o}:${u}`}function ie(n){const{chainNamespace:e}=b.parseCaipNetworkId(n);return se.includes(e)}async function oe(n){const{paymentAssetNetwork:e,activeCaipNetwork:a,approvedCaipNetworkIds:s,requestedCaipNetworks:r}=n,u=_.sortRequestedNetworks(s,r).find(I=>I.caipNetworkId===e);if(!u)throw new c(i.INVALID_PAYMENT_CONFIG);if(u.caipNetworkId===a.caipNetworkId)return;const p=d.getNetworkProp("supportsAllNetworks",u.chainNamespace);if(!(s?.includes(u.caipNetworkId)||p))throw new c(i.INVALID_PAYMENT_CONFIG);try{await d.switchActiveNetwork(u)}catch(I){throw new c(i.GENERIC_PAYMENT_ERROR,I)}}async function ce(n,e,a){if(e!==E.CHAIN.EVM)throw new c(i.INVALID_CHAIN_NAMESPACE);if(!a.fromAddress)throw new c(i.INVALID_PAYMENT_CONFIG,"fromAddress is required for native EVM payments.");const s=typeof a.amount=="string"?parseFloat(a.amount):a.amount;if(isNaN(s))throw new c(i.INVALID_PAYMENT_CONFIG);const r=n.metadata?.decimals??18,o=w.parseUnits(s.toString(),r);if(typeof o!="bigint")throw new c(i.GENERIC_PAYMENT_ERROR);return await w.sendTransaction({chainNamespace:e,to:a.recipient,address:a.fromAddress,value:o,data:"0x"})??void 0}async function ue(n,e){if(!e.fromAddress)throw new c(i.INVALID_PAYMENT_CONFIG,"fromAddress is required for ERC20 EVM payments.");const a=n.asset,s=e.recipient,r=Number(n.metadata.decimals),o=w.parseUnits(e.amount.toString(),r);if(o===void 0)throw new c(i.GENERIC_PAYMENT_ERROR);return await w.writeContract({fromAddress:e.fromAddress,tokenAddress:a,args:[s,o],method:"transfer",abi:j.getERC20Abi(a),chainNamespace:E.CHAIN.EVM})??void 0}async function le(n,e){if(n!==E.CHAIN.SOLANA)throw new c(i.INVALID_CHAIN_NAMESPACE);if(!e.fromAddress)throw new c(i.INVALID_PAYMENT_CONFIG,"fromAddress is required for Solana payments.");const a=typeof e.amount=="string"?parseFloat(e.amount):e.amount;if(isNaN(a)||a<=0)throw new c(i.INVALID_PAYMENT_CONFIG,"Invalid payment amount.");try{if(!B.getProvider(n))throw new c(i.GENERIC_PAYMENT_ERROR,"No Solana provider available.");const r=await w.sendTransaction({chainNamespace:E.CHAIN.SOLANA,to:e.recipient,value:a,tokenMint:e.tokenMint});if(!r)throw new c(i.GENERIC_PAYMENT_ERROR,"Transaction failed.");return r}catch(s){throw s instanceof c?s:new c(i.GENERIC_PAYMENT_ERROR,`Solana payment failed: ${s}`)}}const V=0,R="unknown",t=q({paymentAsset:{network:"eip155:1",asset:"0x0",metadata:{name:"0x0",symbol:"0x0",decimals:0}},recipient:"0x0",amount:0,isConfigured:!1,error:null,isPaymentInProgress:!1,exchanges:[],isLoading:!1,openInNewTab:!0,redirectUrl:void 0,payWithExchange:void 0,currentPayment:void 0,analyticsSet:!1,paymentId:void 0}),l={state:t,subscribe(n){return X(t,()=>n(t))},subscribeKey(n,e){return z(t,n,e)},async handleOpenPay(n){this.resetState(),this.setPaymentConfig(n),this.subscribeEvents(),this.initializeAnalytics(),t.isConfigured=!0,P.sendEvent({type:"track",event:"PAY_MODAL_OPEN",properties:{exchanges:t.exchanges,configuration:{network:t.paymentAsset.network,asset:t.paymentAsset.asset,recipient:t.recipient,amount:t.amount}}}),await x.open({view:"Pay"})},resetState(){t.paymentAsset={network:"eip155:1",asset:"0x0",metadata:{name:"0x0",symbol:"0x0",decimals:0}},t.recipient="0x0",t.amount=0,t.isConfigured=!1,t.error=null,t.isPaymentInProgress=!1,t.isLoading=!1,t.currentPayment=void 0},setPaymentConfig(n){if(!n.paymentAsset)throw new c(i.INVALID_PAYMENT_CONFIG);try{t.paymentAsset=n.paymentAsset,t.recipient=n.recipient,t.amount=n.amount,t.openInNewTab=n.openInNewTab??!0,t.redirectUrl=n.redirectUrl,t.payWithExchange=n.payWithExchange,t.error=null}catch(e){throw new c(i.INVALID_PAYMENT_CONFIG,e.message)}},getPaymentAsset(){return t.paymentAsset},getExchanges(){return t.exchanges},async fetchExchanges(){try{t.isLoading=!0;const n=await Y({page:V,asset:v(t.paymentAsset.network,t.paymentAsset.asset),amount:t.amount.toString()});t.exchanges=n.exchanges.slice(0,2)}catch{throw C.showError(A.UNABLE_TO_GET_EXCHANGES),new c(i.UNABLE_TO_GET_EXCHANGES)}finally{t.isLoading=!1}},async getAvailableExchanges(n){try{const e=n?.asset&&n?.network?v(n.network,n.asset):void 0;return await Y({page:n?.page??V,asset:e,amount:n?.amount?.toString()})}catch{throw new c(i.UNABLE_TO_GET_EXCHANGES)}},async getPayUrl(n,e,a=!1){try{const s=Number(e.amount),r=await ne({exchangeId:n,asset:v(e.network,e.asset),amount:s.toString(),recipient:`${e.network}:${e.recipient}`});return P.sendEvent({type:"track",event:"PAY_EXCHANGE_SELECTED",properties:{source:"pay",exchange:{id:n},configuration:{network:e.network,asset:e.asset,recipient:e.recipient,amount:s},currentPayment:{type:"exchange",exchangeId:n},headless:a}}),a&&(this.initiatePayment(),P.sendEvent({type:"track",event:"PAY_INITIATED",properties:{source:"pay",paymentId:t.paymentId||R,configuration:{network:e.network,asset:e.asset,recipient:e.recipient,amount:s},currentPayment:{type:"exchange",exchangeId:n}}})),r}catch(s){throw s instanceof Error&&s.message.includes("is not supported")?new c(i.ASSET_NOT_SUPPORTED):new Error(s.message)}},async openPayUrl(n,e,a=!1){try{const s=await this.getPayUrl(n.exchangeId,e,a);if(!s)throw new c(i.UNABLE_TO_GET_PAY_URL);const o=n.openInNewTab??!0?"_blank":"_self";return _.openHref(s.url,o),s}catch(s){throw s instanceof c?t.error=s.message:t.error=A.GENERIC_PAYMENT_ERROR,new c(i.UNABLE_TO_GET_PAY_URL)}},subscribeEvents(){t.isConfigured||(w.subscribeKey("connections",n=>{n.size>0&&this.handlePayment()}),d.subscribeChainProp("accountState",n=>{const e=w.hasAnyConnection(E.CONNECTOR_ID.WALLET_CONNECT);n?.caipAddress&&(e?setTimeout(()=>{this.handlePayment()},100):this.handlePayment())}))},async handlePayment(){t.currentPayment={type:"wallet",status:"IN_PROGRESS"};const n=d.getActiveCaipAddress();if(!n)return;const{chainId:e,address:a}=b.parseCaipAddress(n),s=d.state.activeChain;if(!a||!e||!s||!B.getProvider(s))return;const o=d.state.activeCaipNetwork;if(o&&!t.isPaymentInProgress)try{this.initiatePayment();const u=d.getAllRequestedCaipNetworks(),p=d.getAllApprovedCaipNetworkIds();switch(await oe({paymentAssetNetwork:t.paymentAsset.network,activeCaipNetwork:o,approvedCaipNetworkIds:p,requestedCaipNetworks:u}),await x.open({view:"PayLoading"}),s){case E.CHAIN.EVM:t.paymentAsset.asset==="native"&&(t.currentPayment.result=await ce(t.paymentAsset,s,{recipient:t.recipient,amount:t.amount,fromAddress:a})),t.paymentAsset.asset.startsWith("0x")&&(t.currentPayment.result=await ue(t.paymentAsset,{recipient:t.recipient,amount:t.amount,fromAddress:a})),t.currentPayment.status="SUCCESS";break;case E.CHAIN.SOLANA:t.currentPayment.result=await le(s,{recipient:t.recipient,amount:t.amount,fromAddress:a,tokenMint:t.paymentAsset.asset==="native"?void 0:t.paymentAsset.asset}),t.currentPayment.status="SUCCESS";break;default:throw new c(i.INVALID_CHAIN_NAMESPACE)}}catch(u){u instanceof c?t.error=u.message:t.error=A.GENERIC_PAYMENT_ERROR,t.currentPayment.status="FAILED",C.showError(t.error)}finally{t.isPaymentInProgress=!1}},getExchangeById(n){return t.exchanges.find(e=>e.id===n)},validatePayConfig(n){const{paymentAsset:e,recipient:a,amount:s}=n;if(!e)throw new c(i.INVALID_PAYMENT_CONFIG);if(!a)throw new c(i.INVALID_RECIPIENT);if(!e.asset)throw new c(i.INVALID_ASSET);if(s==null||s<=0)throw new c(i.INVALID_AMOUNT)},handlePayWithWallet(){const n=d.getActiveCaipAddress();if(!n){L.push("Connect");return}const{chainId:e,address:a}=b.parseCaipAddress(n),s=d.state.activeChain;if(!a||!e||!s){L.push("Connect");return}this.handlePayment()},async handlePayWithExchange(n){try{t.currentPayment={type:"exchange",exchangeId:n};const{network:e,asset:a}=t.paymentAsset,s={network:e,asset:a,amount:t.amount,recipient:t.recipient},r=await this.getPayUrl(n,s);if(!r)throw new c(i.UNABLE_TO_INITIATE_PAYMENT);return t.currentPayment.sessionId=r.sessionId,t.currentPayment.status="IN_PROGRESS",t.currentPayment.exchangeId=n,this.initiatePayment(),{url:r.url,openInNewTab:t.openInNewTab}}catch(e){return e instanceof c?t.error=e.message:t.error=A.GENERIC_PAYMENT_ERROR,t.isPaymentInProgress=!1,C.showError(t.error),null}},async getBuyStatus(n,e){try{const a=await ae({sessionId:e,exchangeId:n});return(a.status==="SUCCESS"||a.status==="FAILED")&&P.sendEvent({type:"track",event:a.status==="SUCCESS"?"PAY_SUCCESS":"PAY_ERROR",properties:{message:a.status==="FAILED"?_.parseError(t.error):void 0,source:"pay",paymentId:t.paymentId||R,configuration:{network:t.paymentAsset.network,asset:t.paymentAsset.asset,recipient:t.recipient,amount:t.amount},currentPayment:{type:"exchange",exchangeId:t.currentPayment?.exchangeId,sessionId:t.currentPayment?.sessionId,result:a.txHash}}}),a}catch{throw new c(i.UNABLE_TO_GET_BUY_STATUS)}},async updateBuyStatus(n,e){try{const a=await this.getBuyStatus(n,e);t.currentPayment&&(t.currentPayment.status=a.status,t.currentPayment.result=a.txHash),(a.status==="SUCCESS"||a.status==="FAILED")&&(t.isPaymentInProgress=!1)}catch{throw new c(i.UNABLE_TO_GET_BUY_STATUS)}},initiatePayment(){t.isPaymentInProgress=!0,t.paymentId=crypto.randomUUID()},initializeAnalytics(){t.analyticsSet||(t.analyticsSet=!0,this.subscribeKey("isPaymentInProgress",n=>{if(t.currentPayment?.status&&t.currentPayment.status!=="UNKNOWN"){const e={IN_PROGRESS:"PAY_INITIATED",SUCCESS:"PAY_SUCCESS",FAILED:"PAY_ERROR"}[t.currentPayment.status];P.sendEvent({type:"track",event:e,properties:{message:t.currentPayment.status==="FAILED"?_.parseError(t.error):void 0,source:"pay",paymentId:t.paymentId||R,configuration:{network:t.paymentAsset.network,asset:t.paymentAsset.asset,recipient:t.recipient,amount:t.amount},currentPayment:{type:t.currentPayment.type,exchangeId:t.currentPayment.exchangeId,sessionId:t.currentPayment.sessionId,result:t.currentPayment.result}}})}}))}},de=W`
  wui-separator {
    margin: var(--apkt-spacing-3) calc(var(--apkt-spacing-3) * -1) var(--apkt-spacing-2)
      calc(var(--apkt-spacing-3) * -1);
    width: calc(100% + var(--apkt-spacing-3) * 2);
  }

  .token-display {
    padding: var(--apkt-spacing-3) var(--apkt-spacing-3);
    border-radius: var(--apkt-borderRadius-5);
    background-color: var(--apkt-tokens-theme-backgroundPrimary);
    margin-top: var(--apkt-spacing-3);
    margin-bottom: var(--apkt-spacing-3);
  }

  .token-display wui-text {
    text-transform: none;
  }

  wui-loading-spinner {
    padding: var(--apkt-spacing-2);
  }
`;var f=function(n,e,a,s){var r=arguments.length,o=r<3?e:s===null?s=Object.getOwnPropertyDescriptor(e,a):s,u;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")o=Reflect.decorate(n,e,a,s);else for(var p=n.length-1;p>=0;p--)(u=n[p])&&(o=(r<3?u(o):r>3?u(e,a,o):u(e,a))||o);return r>3&&o&&Object.defineProperty(e,a,o),o};let y=class extends F{constructor(){super(),this.unsubscribe=[],this.amount="",this.tokenSymbol="",this.networkName="",this.exchanges=l.state.exchanges,this.isLoading=l.state.isLoading,this.loadingExchangeId=null,this.connectedWalletInfo=d.getAccountData()?.connectedWalletInfo,this.initializePaymentDetails(),this.unsubscribe.push(l.subscribeKey("exchanges",e=>this.exchanges=e)),this.unsubscribe.push(l.subscribeKey("isLoading",e=>this.isLoading=e)),this.unsubscribe.push(d.subscribeChainProp("accountState",e=>{this.connectedWalletInfo=e?.connectedWalletInfo})),l.fetchExchanges()}get isWalletConnected(){return d.getAccountData()?.status==="connected"}render(){return m`
      <wui-flex flexDirection="column">
        <wui-flex flexDirection="column" .padding=${["0","4","4","4"]} gap="3">
          ${this.renderPaymentHeader()}

          <wui-flex flexDirection="column" gap="3">
            ${this.renderPayWithWallet()} ${this.renderExchangeOptions()}
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}initializePaymentDetails(){const e=l.getPaymentAsset();this.networkName=e.network,this.tokenSymbol=e.metadata.symbol,this.amount=l.state.amount.toString()}renderPayWithWallet(){return ie(this.networkName)?m`<wui-flex flexDirection="column" gap="3">
        ${this.isWalletConnected?this.renderConnectedView():this.renderDisconnectedView()}
      </wui-flex>
      <wui-separator text="or"></wui-separator>`:m``}renderPaymentHeader(){let e=this.networkName;if(this.networkName){const s=d.getAllRequestedCaipNetworks().find(r=>r.caipNetworkId===this.networkName);s&&(e=s.name)}return m`
      <wui-flex flexDirection="column" alignItems="center">
        <wui-flex alignItems="center" gap="2">
          <wui-text variant="h1-regular" color="primary">${this.amount||"0.0000"}</wui-text>
          <wui-flex class="token-display" alignItems="center" gap="1">
            <wui-text variant="md-medium" color="primary">
              ${this.tokenSymbol||"Unknown Asset"}
            </wui-text>
            ${e?m`
                  <wui-text variant="sm-medium" color="secondary">
                    on ${e}
                  </wui-text>
                `:""}
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}renderConnectedView(){const e=this.connectedWalletInfo?.name||"connected wallet";return m`
      <wui-list-item
        @click=${this.onWalletPayment}
        ?chevron=${!0}
        ?fullSize=${!0}
        ?rounded=${!0}
        data-testid="wallet-payment-option"
        imageSrc=${G(this.connectedWalletInfo?.icon)}
      >
        <wui-text variant="lg-regular" color="primary">Pay with ${e}</wui-text>
      </wui-list-item>

      <wui-list-item
        icon="power"
        ?rounded=${!0}
        iconColor="error"
        @click=${this.onDisconnect}
        data-testid="disconnect-button"
        ?chevron=${!1}
      >
        <wui-text variant="lg-regular" color="secondary">Disconnect</wui-text>
      </wui-list-item>
    `}renderDisconnectedView(){return m`<wui-list-item
      variant="icon"
      iconVariant="overlay"
      icon="wallet"
      ?rounded=${!0}
      @click=${this.onWalletPayment}
      ?chevron=${!0}
      data-testid="wallet-payment-option"
    >
      <wui-text variant="lg-regular" color="primary">Pay from wallet</wui-text>
    </wui-list-item>`}renderExchangeOptions(){return this.isLoading?m`<wui-flex justifyContent="center" alignItems="center">
        <wui-spinner size="md"></wui-spinner>
      </wui-flex>`:this.exchanges.length===0?m`<wui-flex justifyContent="center" alignItems="center">
        <wui-text variant="md-medium" color="primary">No exchanges available</wui-text>
      </wui-flex>`:this.exchanges.map(e=>m`
        <wui-list-item
          @click=${()=>this.onExchangePayment(e.id)}
          data-testid="exchange-option-${e.id}"
          ?chevron=${!0}
          ?disabled=${this.loadingExchangeId!==null}
          ?loading=${this.loadingExchangeId===e.id}
          imageSrc=${G(e.imageUrl)}
        >
          <wui-flex alignItems="center" gap="3">
            <wui-text flexGrow="1" variant="md-medium" color="primary"
              >Pay with ${e.name} <wui-spinner size="sm" color="secondary"></wui-spinner
            ></wui-text>
          </wui-flex>
        </wui-list-item>
      `)}onWalletPayment(){l.handlePayWithWallet()}async onExchangePayment(e){try{this.loadingExchangeId=e;const a=await l.handlePayWithExchange(e);a&&(await x.open({view:"PayLoading"}),_.openHref(a.url,a.openInNewTab?"_blank":"_self"))}catch(a){console.error("Failed to pay with exchange",a),C.showError("Failed to pay with exchange")}finally{this.loadingExchangeId=null}}async onDisconnect(e){e.stopPropagation();try{await w.disconnect()}catch{console.error("Failed to disconnect"),C.showError("Failed to disconnect")}}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}};y.styles=de;f([h()],y.prototype,"amount",void 0);f([h()],y.prototype,"tokenSymbol",void 0);f([h()],y.prototype,"networkName",void 0);f([h()],y.prototype,"exchanges",void 0);f([h()],y.prototype,"isLoading",void 0);f([h()],y.prototype,"loadingExchangeId",void 0);f([h()],y.prototype,"connectedWalletInfo",void 0);y=f([H("w3m-pay-view")],y);const pe=W`
  :host {
    display: block;
    height: 100%;
    width: 100%;
  }

  wui-flex:first-child:not(:only-child) {
    position: relative;
  }

  wui-loading-thumbnail {
    position: absolute;
  }
`;var k=function(n,e,a,s){var r=arguments.length,o=r<3?e:s===null?s=Object.getOwnPropertyDescriptor(e,a):s,u;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")o=Reflect.decorate(n,e,a,s);else for(var p=n.length-1;p>=0;p--)(u=n[p])&&(o=(r<3?u(o):r>3?u(e,a,o):u(e,a))||o);return r>3&&o&&Object.defineProperty(e,a,o),o};const me=4e3;let N=class extends F{constructor(){super(),this.loadingMessage="",this.subMessage="",this.paymentState="in-progress",this.paymentState=l.state.isPaymentInProgress?"in-progress":"completed",this.updateMessages(),this.setupSubscription(),this.setupExchangeSubscription()}disconnectedCallback(){clearInterval(this.exchangeSubscription)}render(){return m`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        .padding=${["7","5","5","5"]}
        gap="9"
      >
        <wui-flex justifyContent="center" alignItems="center"> ${this.getStateIcon()} </wui-flex>
        <wui-flex flexDirection="column" alignItems="center" gap="2">
          <wui-text align="center" variant="lg-medium" color="primary">
            ${this.loadingMessage}
          </wui-text>
          <wui-text align="center" variant="lg-regular" color="secondary">
            ${this.subMessage}
          </wui-text>
        </wui-flex>
      </wui-flex>
    `}updateMessages(){switch(this.paymentState){case"completed":this.loadingMessage="Payment completed",this.subMessage="Your transaction has been successfully processed";break;case"error":this.loadingMessage="Payment failed",this.subMessage="There was an error processing your transaction";break;case"in-progress":default:l.state.currentPayment?.type==="exchange"?(this.loadingMessage="Payment initiated",this.subMessage="Please complete the payment on the exchange"):(this.loadingMessage="Awaiting payment confirmation",this.subMessage="Please confirm the payment transaction in your wallet");break}}getStateIcon(){switch(this.paymentState){case"completed":return this.successTemplate();case"error":return this.errorTemplate();case"in-progress":default:return this.loaderTemplate()}}setupExchangeSubscription(){l.state.currentPayment?.type==="exchange"&&(this.exchangeSubscription=setInterval(async()=>{const e=l.state.currentPayment?.exchangeId,a=l.state.currentPayment?.sessionId;e&&a&&(await l.updateBuyStatus(e,a),l.state.currentPayment?.status==="SUCCESS"&&clearInterval(this.exchangeSubscription))},me))}setupSubscription(){l.subscribeKey("isPaymentInProgress",e=>{!e&&this.paymentState==="in-progress"&&(l.state.error||!l.state.currentPayment?.result?this.paymentState="error":this.paymentState="completed",this.updateMessages(),setTimeout(()=>{w.state.status!=="disconnected"&&x.close()},3e3))}),l.subscribeKey("error",e=>{e&&this.paymentState==="in-progress"&&(this.paymentState="error",this.updateMessages())})}loaderTemplate(){const e=J.state.themeVariables["--w3m-border-radius-master"],a=e?parseInt(e.replace("px",""),10):4,s=this.getPaymentIcon();return m`
      <wui-flex justifyContent="center" alignItems="center" style="position: relative;">
        ${s?m`<wui-wallet-image size="lg" imageSrc=${s}></wui-wallet-image>`:null}
        <wui-loading-thumbnail radius=${a*9}></wui-loading-thumbnail>
      </wui-flex>
    `}getPaymentIcon(){const e=l.state.currentPayment;if(e){if(e.type==="exchange"){const a=e.exchangeId;if(a)return l.getExchangeById(a)?.imageUrl}if(e.type==="wallet"){const a=d.getAccountData()?.connectedWalletInfo?.icon;if(a)return a;const s=d.state.activeChain;if(!s)return;const r=M.getConnectorId(s);if(!r)return;const o=M.getConnectorById(r);return o?Z.getConnectorImage(o):void 0}}}successTemplate(){return m`<wui-icon size="xl" color="success" name="checkmark"></wui-icon>`}errorTemplate(){return m`<wui-icon size="xl" color="error" name="close"></wui-icon>`}};N.styles=pe;k([h()],N.prototype,"loadingMessage",void 0);k([h()],N.prototype,"subMessage",void 0);k([h()],N.prototype,"paymentState",void 0);N=k([H("w3m-pay-loading-view")],N);const ye=3e5;async function he(n){return l.handleOpenPay(n)}async function Me(n,e=ye){if(e<=0)throw new c(i.INVALID_PAYMENT_CONFIG,"Timeout must be greater than 0");try{await he(n)}catch(a){throw a instanceof c?a:new c(i.UNABLE_TO_INITIATE_PAYMENT,a.message)}return new Promise((a,s)=>{let r=!1;const o=setTimeout(()=>{r||(r=!0,S(),s(new c(i.GENERIC_PAYMENT_ERROR,"Payment timeout")))},e);function u(){if(r)return;const T=l.state.currentPayment,U=l.state.error,K=l.state.isPaymentInProgress;if(T?.status==="SUCCESS"){r=!0,S(),clearTimeout(o),a({success:!0,result:T.result});return}if(T?.status==="FAILED"){r=!0,S(),clearTimeout(o),a({success:!1,error:U||"Payment failed"});return}U&&!K&&!T&&(r=!0,S(),clearTimeout(o),a({success:!1,error:U}))}const p=D("currentPayment",u),g=D("error",u),I=D("isPaymentInProgress",u),S=we([p,g,I]);u()})}function Ge(){return l.getExchanges()}function Ye(){return l.state.currentPayment?.result}function Ve(){return l.state.error}function $e(){return l.state.isPaymentInProgress}function D(n,e){return l.subscribeKey(n,e)}function we(n){return()=>{n.forEach(e=>{try{e()}catch{}})}}const Be={network:"eip155:8453",asset:"native",metadata:{name:"Ethereum",symbol:"ETH",decimals:18}},We={network:"eip155:8453",asset:"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",metadata:{name:"USD Coin",symbol:"USDC",decimals:6}},Fe={network:"eip155:84532",asset:"native",metadata:{name:"Ethereum",symbol:"ETH",decimals:18}},He={network:"eip155:1",asset:"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",metadata:{name:"USD Coin",symbol:"USDC",decimals:6}},Ke={network:"eip155:10",asset:"0x0b2c639c533813f4aa9d7837caf62653d097ff85",metadata:{name:"USD Coin",symbol:"USDC",decimals:6}},je={network:"eip155:42161",asset:"0xaf88d065e77c8cC2239327C5EDb3A432268e5831",metadata:{name:"USD Coin",symbol:"USDC",decimals:6}},qe={network:"eip155:137",asset:"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",metadata:{name:"USD Coin",symbol:"USDC",decimals:6}},ze={network:"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",asset:"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",metadata:{name:"USD Coin",symbol:"USDC",decimals:6}},Xe={network:"eip155:1",asset:"0xdAC17F958D2ee523a2206206994597C13D831ec7",metadata:{name:"Tether USD",symbol:"USDT",decimals:6}},Je={network:"eip155:10",asset:"0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",metadata:{name:"Tether USD",symbol:"USDT",decimals:6}},Ze={network:"eip155:42161",asset:"0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",metadata:{name:"Tether USD",symbol:"USDT",decimals:6}},Qe={network:"eip155:137",asset:"0xc2132d05d31c914a87c6611c10748aeb04b58e8f",metadata:{name:"Tether USD",symbol:"USDT",decimals:6}},et={network:"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",asset:"Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",metadata:{name:"Tether USD",symbol:"USDT",decimals:6}},tt={network:"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",asset:"native",metadata:{name:"Solana",symbol:"SOL",decimals:9}};export{N as W3mPayLoadingView,y as W3mPayView,je as arbitrumUSDC,Ze as arbitrumUSDT,Be as baseETH,Fe as baseSepoliaETH,We as baseUSDC,He as ethereumUSDC,Xe as ethereumUSDT,Ge as getExchanges,$e as getIsPaymentInProgress,Ve as getPayError,Ye as getPayResult,he as openPay,Ke as optimismUSDC,Je as optimismUSDT,Me as pay,qe as polygonUSDC,Qe as polygonUSDT,tt as solanaSOL,ze as solanaUSDC,et as solanaUSDT};
