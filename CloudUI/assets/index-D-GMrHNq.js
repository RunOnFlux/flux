import{c as y,a as b,i as v,x as n,r as k,l as A,Y as u,q as O,Z as C,R as S,O as N,t as L,p as P,W as B,_ as U}from"./crypto-walletconnect-BoPpUqP0.js";import{n as l,r as $}from"./index-D_zm-K7P.js";import"./index-D1jicTFt.js";import"./index-DymnY_n7.js";import{o as W}from"./if-defined-6m10w9Qt.js";import"./index-CV0VcXMx.js";import"./index-DxbOIESz.js";var D;(function(t){t.approve="approved",t.bought="bought",t.borrow="borrowed",t.burn="burnt",t.cancel="canceled",t.claim="claimed",t.deploy="deployed",t.deposit="deposited",t.execute="executed",t.mint="minted",t.receive="received",t.repay="repaid",t.send="sent",t.sell="sold",t.stake="staked",t.trade="swapped",t.unstake="unstaked",t.withdraw="withdrawn"})(D||(D={}));const Y=y`
  :host > wui-flex {
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
    width: 40px;
    height: 40px;
    box-shadow: inset 0 0 0 1px ${({tokens:t})=>t.core.glass010};
    background-color: ${({tokens:t})=>t.core.glass010};
  }

  :host([data-no-images='true']) > wui-flex {
    background-color: ${({tokens:t})=>t.theme.foregroundPrimary};
    border-radius: ${({borderRadius:t})=>t[3]} !important;
  }

  :host > wui-flex wui-image {
    display: block;
  }

  :host > wui-flex,
  :host > wui-flex wui-image,
  .swap-images-container,
  .swap-images-container.nft,
  wui-image.nft {
    border-top-left-radius: var(--local-left-border-radius);
    border-top-right-radius: var(--local-right-border-radius);
    border-bottom-left-radius: var(--local-left-border-radius);
    border-bottom-right-radius: var(--local-right-border-radius);
  }

  wui-icon {
    width: 20px;
    height: 20px;
  }

  .swap-images-container {
    position: relative;
    width: 40px;
    height: 40px;
    overflow: hidden;
  }

  .swap-images-container wui-image:first-child {
    position: absolute;
    width: 40px;
    height: 40px;
    top: 0;
    left: 0%;
    clip-path: inset(0px calc(50% + 2px) 0px 0%);
  }

  .swap-images-container wui-image:last-child {
    clip-path: inset(0px 0px 0px calc(50% + 2px));
  }

  wui-flex.status-box {
    position: absolute;
    right: 0;
    bottom: 0;
    transform: translate(20%, 20%);
    border-radius: ${({borderRadius:t})=>t[4]};
    background-color: ${({tokens:t})=>t.theme.backgroundPrimary};
    box-shadow: 0 0 0 2px ${({tokens:t})=>t.theme.backgroundPrimary};
    overflow: hidden;
    width: 16px;
    height: 16px;
  }
`;var w=function(t,e,r,s){var a=arguments.length,i=a<3?e:s===null?s=Object.getOwnPropertyDescriptor(e,r):s,o;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,r,s);else for(var c=t.length-1;c>=0;c--)(o=t[c])&&(i=(a<3?o(i):a>3?o(e,r,i):o(e,r))||i);return a>3&&i&&Object.defineProperty(e,r,i),i};let d=class extends v{constructor(){super(...arguments),this.images=[],this.secondImage={type:void 0,url:""}}render(){const[e,r]=this.images;this.images.length||(this.dataset.noImages="true");const s=e?.type==="NFT",a=r?.url?r.type==="NFT":s,i=s?"var(--apkt-borderRadius-3)":"var(--apkt-borderRadius-5)",o=a?"var(--apkt-borderRadius-3)":"var(--apkt-borderRadius-5)";return this.style.cssText=`
    --local-left-border-radius: ${i};
    --local-right-border-radius: ${o};
    `,n`<wui-flex> ${this.templateVisual()} ${this.templateIcon()} </wui-flex>`}templateVisual(){const[e,r]=this.images,s=e?.type;return this.images.length===2&&(e?.url||r?.url)?n`<div class="swap-images-container">
        ${e?.url?n`<wui-image src=${e.url} alt="Transaction image"></wui-image>`:null}
        ${r?.url?n`<wui-image src=${r.url} alt="Transaction image"></wui-image>`:null}
      </div>`:e?.url?n`<wui-image src=${e.url} alt="Transaction image"></wui-image>`:s==="NFT"?n`<wui-icon size="inherit" color="default" name="nftPlaceholder"></wui-icon>`:n`<wui-icon size="inherit" color="default" name="coinPlaceholder"></wui-icon>`}templateIcon(){let e="accent-primary",r;return r=this.getIcon(),this.status&&(e=this.getStatusColor()),r?n`
      <wui-flex alignItems="center" justifyContent="center" class="status-box">
        <wui-icon-box size="sm" color=${e} icon=${r}></wui-icon-box>
      </wui-flex>
    `:null}getDirectionIcon(){switch(this.direction){case"in":return"arrowBottom";case"out":return"arrowTop";default:return}}getIcon(){return this.onlyDirectionIcon?this.getDirectionIcon():this.type==="trade"?"swapHorizontal":this.type==="approve"?"checkmark":this.type==="cancel"?"close":this.getDirectionIcon()}getStatusColor(){switch(this.status){case"confirmed":return"success";case"failed":return"error";case"pending":return"inverse";default:return"accent-primary"}}};d.styles=[Y];w([l()],d.prototype,"type",void 0);w([l()],d.prototype,"status",void 0);w([l()],d.prototype,"direction",void 0);w([l({type:Boolean})],d.prototype,"onlyDirectionIcon",void 0);w([l({type:Array})],d.prototype,"images",void 0);w([l({type:Object})],d.prototype,"secondImage",void 0);d=w([b("wui-transaction-visual")],d);const E=y`
  :host {
    width: 100%;
  }

  :host > wui-flex:first-child {
    align-items: center;
    column-gap: ${({spacing:t})=>t[2]};
    padding: ${({spacing:t})=>t[1]} ${({spacing:t})=>t[2]};
    width: 100%;
  }

  :host > wui-flex:first-child wui-text:nth-child(1) {
    text-transform: capitalize;
  }

  wui-transaction-visual {
    width: 40px;
    height: 40px;
  }

  wui-flex {
    flex: 1;
  }

  :host wui-flex wui-flex {
    overflow: hidden;
  }

  :host .description-container wui-text span {
    word-break: break-all;
  }

  :host .description-container wui-text {
    overflow: hidden;
  }

  :host .description-separator-icon {
    margin: 0px 6px;
  }

  :host wui-text > span {
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  }
`;var g=function(t,e,r,s){var a=arguments.length,i=a<3?e:s===null?s=Object.getOwnPropertyDescriptor(e,r):s,o;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,r,s);else for(var c=t.length-1;c>=0;c--)(o=t[c])&&(i=(a<3?o(i):a>3?o(e,r,i):o(e,r))||i);return a>3&&i&&Object.defineProperty(e,r,i),i};let p=class extends v{constructor(){super(...arguments),this.type="approve",this.onlyDirectionIcon=!1,this.images=[]}render(){return n`
      <wui-flex>
        <wui-transaction-visual
          .status=${this.status}
          direction=${W(this.direction)}
          type=${this.type}
          .onlyDirectionIcon=${this.onlyDirectionIcon}
          .images=${this.images}
        ></wui-transaction-visual>
        <wui-flex flexDirection="column" gap="1">
          <wui-text variant="lg-medium" color="primary">
            ${D[this.type]||this.type}
          </wui-text>
          <wui-flex class="description-container">
            ${this.templateDescription()} ${this.templateSecondDescription()}
          </wui-flex>
        </wui-flex>
        <wui-text variant="sm-medium" color="secondary"><span>${this.date}</span></wui-text>
      </wui-flex>
    `}templateDescription(){const e=this.descriptions?.[0];return e?n`
          <wui-text variant="md-regular" color="secondary">
            <span>${e}</span>
          </wui-text>
        `:null}templateSecondDescription(){const e=this.descriptions?.[1];return e?n`
          <wui-icon class="description-separator-icon" size="sm" name="arrowRight"></wui-icon>
          <wui-text variant="md-regular" color="secondary">
            <span>${e}</span>
          </wui-text>
        `:null}};p.styles=[k,E];g([l()],p.prototype,"type",void 0);g([l({type:Array})],p.prototype,"descriptions",void 0);g([l()],p.prototype,"date",void 0);g([l({type:Boolean})],p.prototype,"onlyDirectionIcon",void 0);g([l()],p.prototype,"status",void 0);g([l()],p.prototype,"direction",void 0);g([l({type:Array})],p.prototype,"images",void 0);p=g([b("wui-transaction-list-item")],p);const V=y`
  wui-flex {
    position: relative;
    display: inline-flex;
    justify-content: center;
    align-items: center;
  }

  wui-image {
    border-radius: ${({borderRadius:t})=>t[128]};
  }

  .fallback-icon {
    color: ${({tokens:t})=>t.theme.iconInverse};
    border-radius: ${({borderRadius:t})=>t[3]};
    background-color: ${({tokens:t})=>t.theme.foregroundPrimary};
  }

  .direction-icon,
  .status-image {
    position: absolute;
    right: 0;
    bottom: 0;
    border-radius: ${({borderRadius:t})=>t[128]};
    border: 2px solid ${({tokens:t})=>t.theme.backgroundPrimary};
  }

  .direction-icon {
    padding: ${({spacing:t})=>t["01"]};
    color: ${({tokens:t})=>t.core.iconSuccess};

    background-color: color-mix(
      in srgb,
      ${({tokens:t})=>t.core.textSuccess} 30%,
      ${({tokens:t})=>t.theme.backgroundPrimary} 70%
    );
  }

  /* -- Sizes --------------------------------------------------- */
  :host([data-size='sm']) > wui-image:not(.status-image),
  :host([data-size='sm']) > wui-flex {
    width: 24px;
    height: 24px;
  }

  :host([data-size='lg']) > wui-image:not(.status-image),
  :host([data-size='lg']) > wui-flex {
    width: 40px;
    height: 40px;
  }

  :host([data-size='sm']) .fallback-icon {
    height: 16px;
    width: 16px;
    padding: ${({spacing:t})=>t[1]};
  }

  :host([data-size='lg']) .fallback-icon {
    height: 32px;
    width: 32px;
    padding: ${({spacing:t})=>t[1]};
  }

  :host([data-size='sm']) .direction-icon,
  :host([data-size='sm']) .status-image {
    transform: translate(40%, 30%);
  }

  :host([data-size='lg']) .direction-icon,
  :host([data-size='lg']) .status-image {
    transform: translate(40%, 10%);
  }

  :host([data-size='sm']) .status-image {
    height: 14px;
    width: 14px;
  }

  :host([data-size='lg']) .status-image {
    height: 20px;
    width: 20px;
  }

  /* -- Crop effects --------------------------------------------------- */
  .swap-crop-left-image,
  .swap-crop-right-image {
    position: absolute;
    top: 0;
    bottom: 0;
  }

  .swap-crop-left-image {
    left: 0;
    clip-path: inset(0px calc(50% + 1.5px) 0px 0%);
  }

  .swap-crop-right-image {
    right: 0;
    clip-path: inset(0px 0px 0px calc(50% + 1.5px));
  }
`;var I=function(t,e,r,s){var a=arguments.length,i=a<3?e:s===null?s=Object.getOwnPropertyDescriptor(e,r):s,o;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,r,s);else for(var c=t.length-1;c>=0;c--)(o=t[c])&&(i=(a<3?o(i):a>3?o(e,r,i):o(e,r))||i);return a>3&&i&&Object.defineProperty(e,r,i),i};const R={sm:"xxs",lg:"md"};let f=class extends v{constructor(){super(...arguments),this.type="approve",this.size="lg",this.statusImageUrl="",this.images=[]}render(){return n`<wui-flex>${this.templateVisual()} ${this.templateIcon()}</wui-flex>`}templateVisual(){switch(this.dataset.size=this.size,this.type){case"trade":return this.swapTemplate();case"fiat":return this.fiatTemplate();case"unknown":return this.unknownTemplate();default:return this.tokenTemplate()}}swapTemplate(){const[e,r]=this.images;return this.images.length===2&&(e||r)?n`
        <wui-image class="swap-crop-left-image" src=${e} alt="Swap image"></wui-image>
        <wui-image class="swap-crop-right-image" src=${r} alt="Swap image"></wui-image>
      `:e?n`<wui-image src=${e} alt="Swap image"></wui-image>`:null}fiatTemplate(){return n`<wui-icon
      class="fallback-icon"
      size=${R[this.size]}
      name="dollar"
    ></wui-icon>`}unknownTemplate(){return n`<wui-icon
      class="fallback-icon"
      size=${R[this.size]}
      name="questionMark"
    ></wui-icon>`}tokenTemplate(){const[e]=this.images;return e?n`<wui-image src=${e} alt="Token image"></wui-image> `:n`<wui-icon
      class="fallback-icon"
      name=${this.type==="nft"?"image":"coinPlaceholder"}
    ></wui-icon>`}templateIcon(){return this.statusImageUrl?n`<wui-image
        class="status-image"
        src=${this.statusImageUrl}
        alt="Status image"
      ></wui-image>`:n`<wui-icon
      class="direction-icon"
      size=${R[this.size]}
      name=${this.getTemplateIcon()}
    ></wui-icon>`}getTemplateIcon(){return this.type==="trade"?"arrowClockWise":"arrowBottom"}};f.styles=[V];I([l()],f.prototype,"type",void 0);I([l()],f.prototype,"size",void 0);I([l()],f.prototype,"statusImageUrl",void 0);I([l({type:Array})],f.prototype,"images",void 0);f=I([b("wui-transaction-thumbnail")],f);const F=y`
  :host > wui-flex:first-child {
    gap: ${({spacing:t})=>t[2]};
    padding: ${({spacing:t})=>t[3]};
    width: 100%;
  }

  wui-flex {
    display: flex;
    flex: 1;
  }
`;var G=function(t,e,r,s){var a=arguments.length,i=a<3?e:s===null?s=Object.getOwnPropertyDescriptor(e,r):s,o;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,r,s);else for(var c=t.length-1;c>=0;c--)(o=t[c])&&(i=(a<3?o(i):a>3?o(e,r,i):o(e,r))||i);return a>3&&i&&Object.defineProperty(e,r,i),i};let z=class extends v{render(){return n`
      <wui-flex alignItems="center">
        <wui-shimmer width="40px" height="40px" rounded></wui-shimmer>
        <wui-flex flexDirection="column" gap="1">
          <wui-shimmer width="124px" height="16px" rounded></wui-shimmer>
          <wui-shimmer width="60px" height="14px" rounded></wui-shimmer>
        </wui-flex>
        <wui-shimmer width="24px" height="12px" rounded></wui-shimmer>
      </wui-flex>
    `}};z.styles=[k,F];z=G([b("wui-transaction-list-item-loader")],z);const M=y`
  :host {
    min-height: 100%;
  }

  .group-container[last-group='true'] {
    padding-bottom: ${({spacing:t})=>t[3]};
  }

  .contentContainer {
    height: 280px;
  }

  .contentContainer > wui-icon-box {
    width: 40px;
    height: 40px;
    border-radius: ${({borderRadius:t})=>t[3]};
  }

  .contentContainer > .textContent {
    width: 65%;
  }

  .emptyContainer {
    height: 100%;
  }
`;var x=function(t,e,r,s){var a=arguments.length,i=a<3?e:s===null?s=Object.getOwnPropertyDescriptor(e,r):s,o;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,r,s);else for(var c=t.length-1;c>=0;c--)(o=t[c])&&(i=(a<3?o(i):a>3?o(e,r,i):o(e,r))||i);return a>3&&i&&Object.defineProperty(e,r,i),i};const _="last-transaction",K=7;let m=class extends v{constructor(){super(),this.unsubscribe=[],this.paginationObserver=void 0,this.page="activity",this.caipAddress=A.state.activeCaipAddress,this.transactionsByYear=u.state.transactionsByYear,this.loading=u.state.loading,this.empty=u.state.empty,this.next=u.state.next,u.clearCursor(),this.unsubscribe.push(A.subscribeKey("activeCaipAddress",e=>{e&&this.caipAddress!==e&&(u.resetTransactions(),u.fetchTransactions(e)),this.caipAddress=e}),A.subscribeKey("activeCaipNetwork",()=>{this.updateTransactionView()}),u.subscribe(e=>{this.transactionsByYear=e.transactionsByYear,this.loading=e.loading,this.empty=e.empty,this.next=e.next}))}firstUpdated(){this.updateTransactionView(),this.createPaginationObserver()}updated(){this.setPaginationObserver()}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return n` ${this.empty?null:this.templateTransactionsByYear()}
    ${this.loading?this.templateLoading():null}
    ${!this.loading&&this.empty?this.templateEmpty():null}`}updateTransactionView(){u.resetTransactions(),this.caipAddress&&u.fetchTransactions(O.getPlainAddress(this.caipAddress))}templateTransactionsByYear(){return Object.keys(this.transactionsByYear).sort().reverse().map(r=>{const s=parseInt(r,10),a=new Array(12).fill(null).map((i,o)=>{const c=C.getTransactionGroupTitle(s,o),h=this.transactionsByYear[s]?.[o];return{groupTitle:c,transactions:h}}).filter(({transactions:i})=>i).reverse();return a.map(({groupTitle:i,transactions:o},c)=>{const h=c===a.length-1;return o?n`
          <wui-flex
            flexDirection="column"
            class="group-container"
            last-group="${h?"true":"false"}"
            data-testid="month-indexes"
          >
            <wui-flex
              alignItems="center"
              flexDirection="row"
              .padding=${["2","3","3","3"]}
            >
              <wui-text variant="md-medium" color="secondary" data-testid="group-title">
                ${i}
              </wui-text>
            </wui-flex>
            <wui-flex flexDirection="column" gap="2">
              ${this.templateTransactions(o,h)}
            </wui-flex>
          </wui-flex>
        `:null})})}templateRenderTransaction(e,r){const{date:s,descriptions:a,direction:i,images:o,status:c,type:h,transfers:T,isAllNFT:j}=this.getTransactionListItemProps(e);return n`
      <wui-transaction-list-item
        date=${s}
        .direction=${i}
        id=${r&&this.next?_:""}
        status=${c}
        type=${h}
        .images=${o}
        .onlyDirectionIcon=${j||T.length===1}
        .descriptions=${a}
      ></wui-transaction-list-item>
    `}templateTransactions(e,r){return e.map((s,a)=>{const i=r&&a===e.length-1;return n`${this.templateRenderTransaction(s,i)}`})}emptyStateActivity(){return n`<wui-flex
      class="emptyContainer"
      flexGrow="1"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      .padding=${["10","5","10","5"]}
      gap="5"
      data-testid="empty-activity-state"
    >
      <wui-icon-box color="default" icon="wallet" size="xl"></wui-icon-box>
      <wui-flex flexDirection="column" alignItems="center" gap="2">
        <wui-text align="center" variant="lg-medium" color="primary">No Transactions yet</wui-text>
        <wui-text align="center" variant="lg-regular" color="secondary"
          >Start trading on dApps <br />
          to grow your wallet!</wui-text
        >
      </wui-flex>
    </wui-flex>`}emptyStateAccount(){return n`<wui-flex
      class="contentContainer"
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      gap="4"
      data-testid="empty-account-state"
    >
      <wui-icon-box icon="swapHorizontal" size="lg" color="default"></wui-icon-box>
      <wui-flex
        class="textContent"
        gap="2"
        flexDirection="column"
        justifyContent="center"
        flexDirection="column"
      >
        <wui-text variant="md-regular" align="center" color="primary">No activity yet</wui-text>
        <wui-text variant="sm-regular" align="center" color="secondary"
          >Your next transactions will appear here</wui-text
        >
      </wui-flex>
      <wui-link @click=${this.onReceiveClick.bind(this)}>Trade</wui-link>
    </wui-flex>`}templateEmpty(){return this.page==="account"?n`${this.emptyStateAccount()}`:n`${this.emptyStateActivity()}`}templateLoading(){return this.page==="activity"?Array(K).fill(n` <wui-transaction-list-item-loader></wui-transaction-list-item-loader> `).map(e=>e):null}onReceiveClick(){S.push("WalletReceive")}createPaginationObserver(){const{projectId:e}=N.state;this.paginationObserver=new IntersectionObserver(([r])=>{r?.isIntersecting&&!this.loading&&(u.fetchTransactions(O.getPlainAddress(this.caipAddress)),L.sendEvent({type:"track",event:"LOAD_MORE_TRANSACTIONS",properties:{address:O.getPlainAddress(this.caipAddress),projectId:e,cursor:this.next,isSmartAccount:P(A.state.activeChain)===B.ACCOUNT_TYPES.SMART_ACCOUNT}}))},{}),this.setPaginationObserver()}setPaginationObserver(){this.paginationObserver?.disconnect();const e=this.shadowRoot?.querySelector(`#${_}`);e&&this.paginationObserver?.observe(e)}getTransactionListItemProps(e){const r=U.formatDate(e?.metadata?.minedAt),s=C.mergeTransfers(e?.transfers),a=C.getTransactionDescriptions(e,s),i=s?.[0],o=!!i&&s?.every(h=>!!h.nft_info),c=C.getTransactionImages(s);return{date:r,direction:i?.direction,descriptions:a,isAllNFT:o,images:c,status:e.metadata?.status,transfers:s,type:e.metadata?.operationType}}};m.styles=M;x([l()],m.prototype,"page",void 0);x([$()],m.prototype,"caipAddress",void 0);x([$()],m.prototype,"transactionsByYear",void 0);x([$()],m.prototype,"loading",void 0);x([$()],m.prototype,"empty",void 0);x([$()],m.prototype,"next",void 0);m=x([b("w3m-activity-list")],m);
