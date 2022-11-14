<template>
  <div class="app-details">
    <!-- App Header -->
    <div class="app-detail-header">
      <!-- Header: Left -->
      <div class="app-header-left d-flex align-items-center flex-grow-1">
        <span class="go-back mr-1">
          <feather-icon
            :icon="$store.state.appConfig.isRTL ? 'ChevronRightIcon' : 'ChevronLeftIcon'"
            size="20"
            class="align-bottom"
            @click="$emit('close-sharednode-view')"
          />
        </span>
        <h4 class="app-name mb-0 flex-grow-1">
          Titan Shared Nodes (Beta)
        </h4>
        <a
          href="https://fluxofficial.medium.com/flux-titan-nodes-guide-useful-staking-e527278b1a2a"
          target="_blank"
        >
          Titan Guide
        </a>
      </div>
    </div>

    <!-- App Details -->
    <vue-perfect-scrollbar
      :settings="perfectScrollbarSettings"
      class="marketplace-app-list scroll-area"
    >
      <b-overlay
        variant="transparent"
        opacity="0.95"
        blur="5px"
        no-center
        :show="showOverlay()"
      >
        <template #overlay>
          <div class="mt-5">
            <div class="text-center">
              <b-card
                v-if="titanConfig && titanConfig.maintenanceMessage"
                border-variant="primary"
                class="mx-auto"
                style="max-width: 50rem;"
                title="Titan Maintenance"
              >
                <h1>
                  {{ titanConfig.maintenanceMessage }}
                </h1>
              </b-card>
              <b-spinner
                v-else
                type="border"
                variant="danger"
                style="width: 10rem; height: 10rem;"
              />
            </div>
          </div>
        </template>
        <b-card bg-variant="transparent">
          <b-row class="match-height d-xxl-flex d-none">
            <b-col xl="4">
              <b-card
                border-variant="primary"
                no-body
              >
                <b-card-title class="text-white text-uppercase shared-node-info-title">
                  Active Nodes
                </b-card-title>
                <b-card-body class="shared-node-info-body">
                  <h1 class="active-node-value">
                    {{ nodes.length }}
                  </h1>
                  <div class="d-flex">
                    <h4 class="flex-grow-1">
                      Total: {{ totalCollateral.toLocaleString() }} Flux
                    </h4>
                    <b-avatar
                      size="24"
                      variant="primary"
                      button
                      @click="showNodeInfoDialog()"
                    >
                      <v-icon
                        scale="0.9"
                        name="info"
                      />
                    </b-avatar>
                  </div>
                </b-card-body>
              </b-card>
            </b-col>
            <b-col xl="4">
              <b-card
                border-variant="primary"
                no-body
              >
                <b-card-title class="text-white text-uppercase shared-node-info-title">
                  Staking Stats
                </b-card-title>
                <b-card-body class="shared-node-info-body">
                  <div class="d-flex flex-column">
                    <div class="d-flex flex-row">
                      <h5 class="flex-grow-1">
                        My Staking Total
                      </h5>
                      <h4>
                        {{ myStakes ? toFixedLocaleString(myStakes.reduce((total, stake) => total + stake.collateral, 0), 0) : 0 }}
                      </h4>
                    </div>
                    <div class="d-flex flex-row">
                      <h5 class="flex-grow-1">
                        Titan Staking Total
                      </h5>
                      <h4>
                        {{ titanStats ? toFixedLocaleString(titanStats.total) : '...' }}
                      </h4>
                    </div>
                    <div class="d-flex flex-row">
                      <h5 class="flex-grow-1">
                        Current Supply
                      </h5>
                      <h4>
                        {{ titanStats ? toFixedLocaleString(titanStats.currentsupply) : '...' }}
                      </h4>
                    </div>
                    <div class="d-flex flex-row">
                      <h5 class="flex-grow-1">
                        Max Supply
                      </h5>
                      <h4>
                        {{ titanStats ? toFixedLocaleString(titanStats.maxsupply) : '...' }}
                      </h4>
                    </div>
                    <div>
                      <hr>
                    </div>
                    <div class="d-flex flex-row">
                      <div
                        v-b-tooltip.hover.bottom="tooMuchStaked ? (titanConfig ? titanConfig.stakeDisabledMessage : defaultStakeDisabledMessage) : ''"
                        class="d-flex flex-row flex-grow-1"
                      >
                        <b-button
                          v-if="userZelid"
                          class="flex-grow-1 .btn-relief-primary"
                          variant="gradient-primary"
                          :disabled="tooMuchStaked"
                          @click="showStakeDialog(false)"
                        >
                          Stake Flux
                        </b-button>
                      </div>
                    </div>
                  </div>
                </b-card-body>
              </b-card>
            </b-col>
            <b-col xl="4">
              <b-card
                border-variant="primary"
                no-body
              >
                <b-card-title class="text-white text-uppercase shared-node-info-title">
                  Lockup Period Estimated APR
                </b-card-title>
                <b-card-body
                  v-if="titanConfig"
                  class="shared-node-info-body"
                >
                  <div
                    v-for="lockup in titanConfig.lockups"
                    :key="lockup.time"
                    class="lockup"
                  >
                    <div class="d-flex flex-row">
                      <h2 class="flex-grow-1">
                        {{ lockup.name }}
                      </h2>
                      <h1>
                        ~{{ (lockup.apr*100).toFixed(2) }}%
                      </h1>
                    </div>
                  </div>
                  <div class="float-right">
                    <b-avatar
                      size="24"
                      variant="primary"
                      button
                      @click="showAPRInfoDialog()"
                    >
                      <v-icon
                        scale="0.9"
                        name="info"
                      />
                    </b-avatar>
                  </div>
                </b-card-body>
              </b-card>
            </b-col>
          </b-row>
          <b-row class="match-height d-xxl-none d-xl-flex d-lg-flex d-md-flex d-sm-flex">
            <b-col sm="12">
              <b-card
                border-variant="primary"
                no-body
              >
                <b-card-title
                  class="text-white text-uppercase"
                  style="padding-left: 1.5rem; padding-top: 1rem; margin-bottom: 0;"
                >
                  Active Nodes
                </b-card-title>
                <b-row class="match-height">
                  <b-col cols="6">
                    <h1 class="active-node-value-xl">
                      {{ nodes.length }}
                    </h1>
                  </b-col>
                  <b-col cols="6">
                    <h4
                      class="text-center"
                      style="padding-top: 2rem"
                    >
                      Total: {{ totalCollateral.toLocaleString() }} Flux
                    </h4>
                    <h4 class="text-center">
                      <b-avatar
                        size="24"
                        variant="primary"
                        button
                        @click="showNodeInfoDialog()"
                      >
                        <v-icon
                          scale="0.9"
                          name="info"
                        />
                      </b-avatar>
                    </h4>
                  </b-col>
                </b-row>
              </b-card>
            </b-col>
            <b-col sm="12">
              <b-row class="match-height">
                <b-col sm="6">
                  <b-card
                    border-variant="primary"
                    no-body
                  >
                    <b-card-title class="text-white text-uppercase shared-node-info-title-xl">
                      Staking Stats
                    </b-card-title>
                    <b-card-body class="shared-node-info-body-xl">
                      <div class="d-flex flex-column">
                        <div class="d-flex flex-row">
                          <h5 class="flex-grow-1">
                            My Staking Total
                          </h5>
                          <h4>
                            {{ myStakes ? toFixedLocaleString(myStakes.reduce((total, stake) => total + stake.collateral, 0), 0) : 0 }}
                          </h4>
                        </div>
                        <div class="d-flex flex-row">
                          <h5 class="flex-grow-1">
                            Titan Staking Total
                          </h5>
                          <h4>
                            {{ titanStats ? toFixedLocaleString(titanStats.total) : '...' }}
                          </h4>
                        </div>
                        <div class="d-flex flex-row">
                          <h5 class="flex-grow-1">
                            Current Supply
                          </h5>
                          <h4>
                            {{ titanStats ? toFixedLocaleString(titanStats.currentsupply) : '...' }}
                          </h4>
                        </div>
                        <div class="d-flex flex-row">
                          <h5 class="flex-grow-1">
                            Max Supply
                          </h5>
                          <h4>
                            {{ titanStats ? toFixedLocaleString(titanStats.maxsupply) : '...' }}
                          </h4>
                        </div>
                        <div>
                          <hr>
                        </div>
                        <div class="d-flex flex-row">
                          <div
                            v-b-tooltip.hover.bottom="tooMuchStaked ? (titanConfig ? titanConfig.stakeDisabledMessage : defaultStakeDisabledMessage) : ''"
                            class="d-flex flex-row flex-grow-1"
                          >
                            <b-button
                              v-if="userZelid"
                              class="flex-grow-1 .btn-relief-primary"
                              variant="gradient-primary"
                              :disabled="tooMuchStaked"
                              @click="showStakeDialog(false)"
                            >
                              Stake Flux
                            </b-button>
                          </div>
                        </div>
                      </div>
                    </b-card-body>
                  </b-card>
                </b-col>
                <b-col sm="6">
                  <b-card
                    border-variant="primary"
                    no-body
                  >
                    <b-card-title class="text-white text-uppercase shared-node-info-title-xl">
                      Lockup Period APR
                    </b-card-title>
                    <b-card-body
                      v-if="titanConfig"
                      class="shared-node-info-body-xl"
                    >
                      <div
                        v-for="lockup in titanConfig.lockups"
                        :key="lockup.time"
                        class="lockup"
                      >
                        <div class="d-flex flex-row">
                          <h4 class="flex-grow-1">
                            {{ lockup.name }}
                          </h4>
                          <h4>
                            ~{{ (lockup.apr*100).toFixed(2) }}%
                          </h4>
                        </div>
                      </div>
                      <div class="float-right">
                        <b-avatar
                          size="24"
                          variant="primary"
                          button
                          @click="showAPRInfoDialog()"
                        >
                          <v-icon
                            scale="0.9"
                            name="info"
                          />
                        </b-avatar>
                      </div>
                    </b-card-body>
                  </b-card>
                </b-col>
              </b-row>
            </b-col>
          </b-row>
        </b-card>
        <b-card
          v-if="!userZelid"
          title="My Stakes"
        >
          <h5>
            Please login using your ZelID to view your node stakes
          </h5>
        </b-card>
        <b-row
          v-else
          class=""
        >
          <b-col
            class="d-xxl-none d-xl-flex d-lg-flex d-md-flex d-sm-flex"
          >
            <b-card
              no-body
              class="flex-grow-1"
            >
              <b-card-title
                class="stakes-title"
              >
                Redeem Rewards
              </b-card-title>
              <b-card-body>
                <div class="d-flex flex-row">
                  <h5 class="flex-grow-1">
                    Paid:
                  </h5>
                  <h4>
                    {{ calculatePaidRewards() }} Flux
                  </h4>
                </div>
                <div class="d-flex flex-row">
                  <h5 class="flex-grow-1">
                    Available:
                  </h5>
                  <h4>
                    {{ toFixedLocaleString(totalReward, 2) }} Flux
                  </h4>
                </div>
                <div
                  v-b-tooltip.hover.bottom="totalReward <= (titanConfig ? titanConfig.redeemFee : 0) ? 'Available balance is less than the redeem fee' : ''"
                  class="float-right"
                  style="display: inline-block;"
                >
                  <b-button
                    v-if="totalReward > minStakeAmount"
                    :disabled="totalReward >= totalCollateral - titanStats.total"
                    class="mt-2 mr-1"
                    variant="danger"
                    size="sm"
                    pill
                    @click="showStakeDialog(true)"
                  >
                    Re-invest Funds
                  </b-button>
                  <b-button
                    id="redeemButton"
                    class="float-right mt-2"
                    variant="danger"
                    size="sm"
                    pill
                    :disabled="totalReward <= (titanConfig ? titanConfig.redeemFee : 0)"
                    @click="showRedeemDialog()"
                  >
                    Redeem
                  </b-button>
                </div>
              </b-card-body>
            </b-card>
          </b-col>
          <b-col xxl="9">
            <b-card
              class="sharednodes-container"
              no-body
            >
              <b-card-body>
                <b-tabs>
                  <b-tab
                    active
                    title="Active Stakes"
                  >
                    <ul
                      class="marketplace-media-list"
                    >
                      <b-media
                        v-for="stake in myStakes"
                        :key="stake.uuid"
                        tag="li"
                        no-body
                        @click="showActiveStakeInfoDialog(stake)"
                      >
                        <b-media-body
                          class="app-media-body"
                          style="overflow: inherit;"
                        >
                          <div class="d-flex flex-row row">
                            <b-avatar
                              v-if="stake.confirmations === -1"
                              size="48"
                              variant="danger"
                              class="node-status mt-auto mb-auto"
                              button
                              @click="showPaymentDetailsDialog(stake)"
                              @click.stop=""
                            >
                              <v-icon
                                scale="1.75"
                                name="hourglass-half"
                              />
                            </b-avatar>
                            <b-avatar
                              v-else-if="titanConfig && stake.confirmations >= titanConfig.confirms"
                              size="48"
                              variant="light-success"
                              class="node-status mt-auto mb-auto"
                            >
                              <v-icon
                                scale="1.75"
                                name="check"
                              />
                            </b-avatar>
                            <b-avatar
                              v-else
                              size="48"
                              variant="light-warning"
                              class="node-status mt-auto mb-auto"
                            >
                              {{ stake.confirmations }}/{{ titanConfig ? titanConfig.confirms : 0 }}
                            </b-avatar>
                            <div
                              class="d-flex flex-column seat-column col"
                              style="flex-grow: 0.8;"
                            >
                              <h3 class="mr-auto ml-auto mt-auto mb-auto">
                                {{ stake.collateral.toLocaleString() }} Flux
                              </h3>
                            </div>
                            <div class="d-flex flex-column seat-column col">
                              <h4
                                v-b-tooltip.hover.top="new Date(stake.timestamp*1000).toLocaleString(timeoptions)"
                                class="mr-auto ml-auto text-center"
                              >
                                Start Date: {{ new Date(stake.timestamp*1000).toLocaleDateString() }}
                              </h4>
                              <h5
                                v-b-tooltip.hover.top="new Date(stake.expiry*1000).toLocaleString(timeoptions)"
                                class="mr-auto ml-auto text-center"
                              >
                                End Date: {{ new Date(stake.expiry*1000).toLocaleDateString() }}
                              </h5>
                            </div>
                            <div class="d-flex flex-column seat-column col">
                              <h4 class="mr-auto ml-auto">
                                Paid: {{ toFixedLocaleString(stake.paid, 2) }} Flux
                              </h4>
                              <h5 class="mr-auto ml-auto">
                                Pending: {{ toFixedLocaleString(stake.reward, 2) }} Flux
                              </h5>
                            </div>
                            <div class="d-flex flex-column seat-column col">
                              <h4 class="mr-auto ml-auto text-center">
                                Monthly Rewards
                              </h4>
                              <h5
                                v-if="titanConfig"
                                class="mr-auto ml-auto"
                              >
                                ~{{ toFixedLocaleString(calcMonthlyReward(stake), 2) }} Flux
                                <v-icon
                                  v-if="stake.autoreinvest"
                                  v-b-tooltip.hover.top="'Stake will auto-reinvest'"
                                  name="sync"
                                />
                              </h5>
                              <h5
                                v-else
                                class="mr-auto ml-auto"
                              >
                                ... Flux
                              </h5>
                            </div>
                          </div>
                          <div v-if="stake.message">
                            <!-- eslint-disable-next-line vue/no-v-html -->
                            <div v-html="stake.message" />
                          </div>
                        </b-media-body>
                      </b-media>
                    </ul>
                  </b-tab>
                  <b-tab
                    v-if="myExpiredStakes.length > 0"
                    title="Expired Stakes"
                  >
                    <ul
                      class="marketplace-media-list"
                    >
                      <b-media
                        v-for="stake in myExpiredStakes"
                        :key="stake.uuid"
                        tag="li"
                        no-body
                      >
                        <b-media-body
                          class="app-media-body"
                          style="overflow: inherit;"
                        >
                          <div class="d-flex flex-row row">
                            <b-avatar
                              size="48"
                              variant="light-warning"
                              class="node-status mt-auto mb-auto"
                            >
                              <v-icon
                                scale="1.75"
                                name="calendar-times"
                              />
                            </b-avatar>
                            <div
                              class="d-flex flex-column seat-column col"
                              style="flex-grow: 0.8;"
                            >
                              <h3 class="mr-auto ml-auto mt-auto mb-auto">
                                {{ stake.collateral.toLocaleString() }} Flux
                              </h3>
                            </div>
                            <div class="d-flex flex-column seat-column col">
                              <h4
                                v-b-tooltip.hover.top="new Date(stake.timestamp*1000).toLocaleString(timeoptions)"
                                class="mr-auto ml-auto"
                              >
                                Start Date: {{ new Date(stake.timestamp*1000).toLocaleDateString() }}
                              </h4>
                              <h5
                                v-b-tooltip.hover.top="new Date(stake.expiry*1000).toLocaleString(timeoptions)"
                                class="mr-auto ml-auto"
                              >
                                End Date: {{ new Date(stake.expiry*1000).toLocaleDateString() }}
                              </h5>
                            </div>
                            <div class="d-flex flex-column seat-column col">
                              <h4 class="mr-auto ml-auto">
                                Paid: {{ stake.state === 5 ? toFixedLocaleString(stake.paid - stake.collateral, 2) : toFixedLocaleString(stake.paid, 2) }} Flux
                              </h4>
                              <h5 class="mr-auto ml-auto">
                                Pending: {{ toFixedLocaleString(stake.reward, 2) }} Flux
                              </h5>
                            </div>
                            <div class="d-flex">
                              <b-button
                                class="float-right mt-1 mb-1"
                                :variant="stake.state >= 5 ? 'outline-secondary' : 'danger'"
                                size="sm"
                                :disabled="stake.state >= 5 || (totalReward >= totalCollateral - titanStats.total)"
                                pill
                                style="width: 100px"
                                @click="showReinvestDialog(stake)"
                              >
                                {{ stake.state >= 5 ? 'Complete' : 'Reinvest' }}
                              </b-button>
                            </div>
                          </div>
                        </b-media-body>
                      </b-media>
                    </ul>
                  </b-tab>
                  <b-tab title="Payments">
                    <ul
                      class="marketplace-media-list"
                    >
                      <b-table
                        class="payments-table"
                        striped
                        hover
                        responsive
                        :items="myPayments"
                        :fields="paymentFields"
                        show-empty
                        empty-text="No Payments"
                      >
                        <template #cell(timestamp)="data">
                          {{ new Date(data.item.timestamp).toLocaleString(timeoptions) }}
                        </template>
                        <template #cell(total)="data">
                          <p
                            v-b-tooltip.hover.right="`Amount = ${toFixedLocaleString(data.item.total, 2)} Flux - ${data.item.fee} Flux redeem fee`"
                            style="margin-bottom: 0"
                          >
                            {{ toFixedLocaleString(data.item.total - data.item.fee, 2) }} Flux
                          </p>
                        </template>
                        <template #cell(address)="data">
                          <a
                            :href="`https://explorer.runonflux.io/address/${data.item.address}`"
                            target="_blank"
                          >
                            {{ data.item.address }}
                          </a>
                        </template>
                        <template #cell(txid)="data">
                          <a
                            v-if="data.item.txid"
                            :href="`https://explorer.runonflux.io/tx/${data.item.txid}`"
                            target="_blank"
                          >
                            View on Explorer
                          </a>
                          <h5 v-else>
                            {{ data.item.state || 'Processing' }}
                          </h5>
                        </template>
                      </b-table>
                    </ul>
                  </b-tab>
                </b-tabs>
              </b-card-body>
            </b-card>
          </b-col>
          <b-col
            xxl="3"
            class="d-xxl-flex d-xl-none d-lg-none d-md-none d-sm-none"
          >
            <b-card
              no-body
              class="flex-grow-1"
            >
              <b-card-title
                class="stakes-title"
              >
                Redeem Rewards
              </b-card-title>
              <b-card-body>
                <div class="d-flex flex-row">
                  <h5 class="flex-grow-1">
                    Paid:
                  </h5>
                  <h4>
                    {{ calculatePaidRewards() }} Flux
                  </h4>
                </div>
                <div class="d-flex flex-row">
                  <h5 class="flex-grow-1">
                    Available:
                  </h5>
                  <h4>
                    {{ toFixedLocaleString(totalReward, 2) }} Flux
                  </h4>
                </div>
                <div
                  v-b-tooltip.hover.bottom="totalReward <= (titanConfig ? titanConfig.redeemFee : 0) ? 'Available balance is less than the redeem fee' : ''"
                  class="float-right"
                  style="display: inline-block;"
                >
                  <b-button
                    v-if="totalReward > minStakeAmount"
                    :disabled="totalReward >= totalCollateral - titanStats.total"
                    class="mt-2 mr-1"
                    variant="danger"
                    size="sm"
                    pill
                    @click="showStakeDialog(true)"
                  >
                    Re-invest Funds
                  </b-button>
                  <b-button
                    id="redeemButton"
                    class="float-right mt-2"
                    variant="danger"
                    size="sm"
                    pill
                    :disabled="totalReward <= (titanConfig ? titanConfig.redeemFee : 0)"
                    @click="showRedeemDialog()"
                  >
                    Redeem
                  </b-button>
                </div>
              </b-card-body>
            </b-card>
          </b-col>
        </b-row>
      </b-overlay>
    </vue-perfect-scrollbar>

    <!-- Titan Nodes Dialog -->
    <b-modal
      v-model="nodeModalShowing"
      title="Titan Nodes"
      size="lg"
      centered
      button-size="sm"
      ok-only
      @ok="() => nodeModalShowing = false"
    >
      <b-card
        v-for="node in nodes"
        :key="node.uuid"
        :title="node.name"
      >
        <b-row>
          <b-col>
            <h5>
              Location: {{ node.location }}
            </h5>
          </b-col>
          <b-col>
            <h5>
              Collateral: {{ toFixedLocaleString(node.collateral, 0) }}
            </h5>
          </b-col>
        </b-row>
        <b-row>
          <b-col>
            <h5>
              Created: {{ new Date(node.created).toLocaleDateString() }}
            </h5>
          </b-col>
          <b-col>
            <b-button
              pill
              size="sm"
              variant="primary"
              @click="visitNode(node)"
            >
              Visit
            </b-button>
          </b-col>
        </b-row>
      </b-card>
    </b-modal>

    <!-- Lockup APR dialog -->
    <b-modal
      v-model="aprModalShowing"
      title="Lockup APR"
      size="md"
      centered
      button-size="sm"
      ok-only
      @ok="() => aprModalShowing = false"
    >
      <b-card
        title="APR Calculations"
      >
        <p class="text-center">
          The APR for a Titan Shared Nodes lockup is dependent on the number of active Stratus nodes on the Flux network and the current block reward.
        </p>
        <p class="text-center">
          APR is calculated using this basic formula:
        </p>
        <p class="text-center">
          Per block reward (22.5) x Blocks per day (720) x 365 /<br>
          &nbsp;(Number of Stratus nodes * 40,000)
        </p>
        <p class="text-center">
          <br>
          <b-avatar
            size="24"
            variant="warning"
            button
          >
            <v-icon
              scale="0.9"
              name="info"
            />
          </b-avatar>
          APR does not mean the actual or predicted returns in fiat currency or Flux.
        </p>
      </b-card>
    </b-modal>

    <!-- Redeem Rewards Dialog -->
    <b-modal
      v-model="redeemModalShowing"
      title="Redeem Rewards"
      size="lg"
      centered
      button-size="sm"
      ok-only
      no-close-on-backdrop
      no-close-on-esc
      ok-title="Cancel"
      @ok="redeemModalShowing = false; getMyPayments(true);"
    >
      <form-wizard
        :color="tierColors.cumulus"
        :title="null"
        :subtitle="null"
        layout="vertical"
        back-button-text="Previous"
        class="wizard-vertical mb-3"
        @on-complete="confirmRedeemDialogFinish()"
      >
        <tab-content
          title="Redeem Amount"
        >
          <b-card
            title="Redeem Amount"
            class="text-center wizard-card"
          >
            <h4>
              Available: {{ toFixedLocaleString(totalReward, 2) }} Flux
            </h4>
            <h4 style="margin-top: 10px;">
              You will receive
            </h4>
            <h3>
              {{ toFixedLocaleString(totalReward - calculateRedeemFee(), 2) }} Flux
            </h3>
            <h6>
              (<span class="text-warning">Redeem Fee:</span>
              <span
                v-if="titanConfig && titanConfig.maxRedeemFee"
                v-b-tooltip.hover.bottom="`Fee of ${titanConfig.redeemFee}% of your rewards, capped at ${titanConfig.maxRedeemFee} Flux`"
                class="text-danger"
              > {{ toFixedLocaleString(calculateRedeemFee(), 8) }} Flux
              </span>
              <span
                v-else
                class="text-danger"
              >
                {{ titanConfig ? titanConfig.redeemFee : '...' }} Flux
              </span>)
              <!--(<span class="text-warning">Redeem Fee:</span> <span class="text-danger">{{ calculateRedeemFee() }} Flux</span>)-->
            </h6>
          </b-card>
        </tab-content>
        <tab-content
          title="Redeem Address"
          :before-change="() => checkRedeemAddress()"
        >
          <b-card
            title="Choose Redeem Address"
            class="text-center wizard-card"
          >
            <b-form-select
              v-model="redeemAddress"
              :options="redeemAddresses"
              :disabled="sendingRequest || requestSent || requestFailed"
            >
              <template #first>
                <b-form-select-option
                  :value="null"
                  disabled
                >
                  -- Please select an address --
                </b-form-select-option>
              </template>
            </b-form-select>
          </b-card>
        </tab-content>
        <tab-content
          title="Sign Request"
          :before-change="() => signature !== null"
        >
          <b-card
            title="Sign Redeem Request with Zelcore"
            class="text-center wizard-card"
          >
            <a
              :href="(sendingRequest || requestSent || requestFailed) ? '#' : `zel:?action=sign&message=${dataToSign}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue()}`"
              @click="initiateSignWS"
            >
              <img
                class="zelidLogin mb-2"
                src="@/assets/images/zelID.svg"
                alt="Zel ID"
                height="100%"
                width="100%"
              >
            </a>
            <b-form-input
              id="data"
              v-model="dataToSign"
              :disabled="true"
              class="mb-1"
            />
            <b-form-input
              id="signature"
              v-model="signature"
              :disabled="sendingRequest || requestSent || requestFailed"
            />
          </b-card>
        </tab-content>
        <tab-content
          title="Request Redeem"
          :before-change="() => requestSent === true"
        >
          <b-card
            title="Submit Redeem Request"
            class="text-center wizard-card"
          >
            <div class="mt-3 mb-auto ">
              <b-button
                size="lg"
                :disabled="sendingRequest || requestSent"
                variant="warning"
                @click="requestRedeem"
              >
                Submit Request
              </b-button>
              <h4
                v-if="requestSent"
                class="mt-3 text-success"
              >
                Redeem request has been received and will be processed within 24 hours
              </h4>
              <h4
                v-if="requestFailed"
                class="mt-3 text-danger"
              >
                Redeem request failed
              </h4>
            </div>
          </b-card>
        </tab-content>
      </form-wizard>
    </b-modal>

    <!-- Pending Payment Details Dialog -->
    <b-modal
      v-model="paymentDetailsDialogShowing"
      title="Pending Payment"
      size="md"
      centered
      button-size="sm"
      ok-only
      ok-title="OK"
      @ok="paymentDetailsDialogShowing = false;"
    >
      <b-card
        v-if="selectedStake"
        title="Send Funds"
        class="text-center payment-details-card"
      >
        <b-card-text>
          To finish staking, send <span class="text-success">{{ toFixedLocaleString(selectedStake.collateral) }}</span> FLUX to address<br>
          <h5
            class="text-wrap ml-auto mr-auto text-warning mt-1"
            style="width: 25rem;"
          >
            {{ titanConfig.fundingAddress }}
          </h5>
          with the following message<br>
          <h5
            class="text-wrap ml-auto mr-auto text-warning mt-1"
            style="width: 25rem;"
          >
            {{ selectedStake.signatureHash }}
          </h5>
          <div class="d-flex flex-row mt-2">
            <h3 class="col text-center mt-2">
              Pay with<br>Zelcore
            </h3>
            <a
              :href="`zel:?action=pay&coin=zelcash&address=${titanConfig.fundingAddress}&amount=${selectedStake.collateral}&message=${selectedStake.signatureHash}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png`"
              class="col"
            >
              <img
                class="zelidLogin"
                src="@/assets/images/zelID.svg"
                alt="Zel ID"
                height="100%"
                width="100%"
              >
            </a>
          </div>
          <h5 class="mt-1">
            This stake will expire if the transaction is not on the blockchain before <span class="text-danger">{{ new Date(selectedStake.expiry * 1000).toLocaleString() }}</span>
          </h5>
        </b-card-text>
      </b-card>
    </b-modal>

    <!-- Cancel Staking Dialog -->
    <b-modal
      v-model="confirmStakeDialogCloseShowing"
      title="Cancel Staking?"
      size="sm"
      centered
      button-size="sm"
      ok-title="Yes"
      cancel-title="No"
      @ok="confirmStakeDialogCloseShowing = false; stakeModalShowing = false;"
    >
      <h3 class="text-center">
        Are you sure you want to cancel staking with Titan?
      </h3>
    </b-modal>

    <!-- Finish Staking Confirmation Dialog -->
    <b-modal
      v-model="confirmStakeDialogFinishShowing"
      title="Finish Staking?"
      size="sm"
      centered
      button-size="sm"
      ok-title="Yes"
      cancel-title="No"
      @ok="confirmStakeDialogFinishShowing = false; stakeModalShowing = false;"
    >
      <h3 class="text-center">
        Please ensure that you have sent payment for your stake, or saved the payment details for later.
      </h3>
      <br>
      <h4 class="text-center">
        Close the Titan Staking dialog?
      </h4>
    </b-modal>

    <!-- Re-invest Expired Stake Dialog -->
    <b-modal
      v-model="reinvestModalShowing"
      title="Re-invest Expired Stake"
      size="lg"
      centered
      no-close-on-backdrop
      no-close-on-esc
      button-size="sm"
      ok-only
      ok-title="Cancel"
      @ok="reinvestModalShowing = false;"
    >
      <form-wizard
        :color="tierColors.cumulus"
        :title="null"
        :subtitle="null"
        layout="vertical"
        back-button-text="Previous"
        class="wizard-vertical mb-3"
        @on-complete="reinvestDialogFinish()"
      >
        <tab-content
          title="Update Stake"
        >
          <b-card
            title="Update Stake"
            class="text-center wizard-card"
          >
            <div
              v-if="selectedStake"
              class="d-flex flex-column"
            >
              <b-form-checkbox
                v-model="selectedStake.autoreinvest"
                :disabled="stakeRegistered || registeringStake || stakeRegisterFailed"
                class="ml-auto mr-auto"
                style="float: left;"
              >
                Auto-reinvest this stake after expiry
              </b-form-checkbox>
              <div
                v-if="titanConfig && titanConfig.reinvestFee > 0 && titanConfig.maxReinvestFee"
                class="mt-2"
              >
                <h6>
                  <span class="text-warning">Re-invest Fee:</span>
                  <span
                    v-b-tooltip.hover.bottom="`Fee of ${titanConfig.reinvestFee}% of your rewards, capped at ${titanConfig.maxReinvestFee} Flux`"
                    class="text-danger"
                  > {{ toFixedLocaleString(calculateReinvestFee(), 8) }} Flux
                  </span>
                </h6>
              </div>
            </div>
          </b-card>
        </tab-content>
        <tab-content
          title="Choose Duration"
          :before-change="() => checkReinvestDuration()"
        >
          <b-card
            v-if="titanConfig"
            title="Select Lockup Period"
            class="text-center wizard-card"
          >
            <div
              v-for="(lockup, index) in titanConfig.lockups"
              :key="lockup.time"
              class="mb-1"
            >
              <div class="ml-auto mr-auto">
                <b-button
                  :class="index === selectedLockupIndex ? 'selectedLockupButton' : 'unselectedLockupButton'"
                  :style="`background-color: ${indexedTierColors[index]} !important;`"
                  :disabled="stakeRegistered || registeringStake || stakeRegisterFailed"
                  @click="selectLockup(index)"
                >
                  {{ lockup.name }} - ~{{ (lockup.apr*100).toFixed(2) }}%
                </b-button>
              </div>
            </div>
          </b-card>
        </tab-content>
        <tab-content
          title="Sign Stake"
          :before-change="() => signature !== null"
        >
          <b-card
            title="Sign Stake with Zelcore"
            class="text-center wizard-card"
          >
            <a
              :href="(stakeRegistered || registeringStake || stakeRegisterFailed) ? '#' : `zel:?action=sign&message=${dataToSign}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue()}`"
              @click="initiateSignWS"
            >
              <img
                class="zelidLogin mb-2"
                src="@/assets/images/zelID.svg"
                alt="Zel ID"
                height="100%"
                width="100%"
              >
            </a>
            <b-form-input
              id="data"
              v-model="dataToSign"
              :disabled="true"
              class="mb-1"
            />
            <b-form-input
              id="signature"
              v-model="signature"
              :disabled="stakeRegistered || registeringStake || stakeRegisterFailed"
            />
          </b-card>
        </tab-content>
        <tab-content
          title="Re-invest Stake"
          :before-change="() => stakeRegistered === true"
        >
          <b-card
            title="Re-invest Stake with Titan"
            class="text-center wizard-card"
          >
            <div class="mt-3 mb-auto ">
              <b-button
                size="lg"
                :disabled="registeringStake || stakeRegistered"
                variant="success"
                @click="reinvestStake"
              >
                Re-invest Stake
              </b-button>
              <h4
                v-if="stakeRegistered"
                class="mt-3 text-success"
              >
                Registration received
              </h4>
              <h4
                v-if="stakeRegisterFailed"
                class="mt-3 text-danger"
              >
                Registration failed
              </h4>
            </div>
          </b-card>
        </tab-content>
      </form-wizard>
    </b-modal>

    <!-- Active Stake Details Dialog -->
    <b-modal
      v-model="activeStakeInfoModalShowing"
      title="Active Stake Details"
      size="sm"
      centered
      button-size="sm"
      cancel-title="Close"
      ok-title="Edit"
      @ok="editActiveStake"
    >
      <b-card v-if="selectedStake">
        <div class="d-flex">
          <b-form-checkbox
            v-model="selectedStake.autoreinvest"
            disabled
            class="ml-auto mr-auto"
            style="float: left;"
          >
            Auto-reinvest this stake after expiry
          </b-form-checkbox>
        </div>
      </b-card>
    </b-modal>

    <!-- Edit Active Stake Dialog -->
    <b-modal
      v-model="editStakeModalShowing"
      title="Edit Active Stake"
      size="lg"
      centered
      no-close-on-backdrop
      no-close-on-esc
      button-size="sm"
      ok-only
      ok-title="Cancel"
      @ok="editStakeModalShowing = false;"
    >
      <form-wizard
        :color="tierColors.cumulus"
        :title="null"
        :subtitle="null"
        layout="vertical"
        back-button-text="Previous"
        class="wizard-vertical mb-3"
        @on-complete="editStakeModalShowing = false; getMyStakes(true);"
      >
        <tab-content
          title="Update Stake"
        >
          <b-card
            title="Update Stake"
            class="text-center wizard-card"
          >
            <div
              v-if="selectedStake"
              class="d-flex"
            >
              <b-form-checkbox
                v-model="selectedStake.autoreinvest"
                :disabled="stakeRegistered || registeringStake || stakeRegisterFailed"
                class="ml-auto mr-auto"
                style="float: left;"
              >
                Auto-reinvest this stake after expiry
              </b-form-checkbox>
            </div>
          </b-card>
        </tab-content>
        <tab-content
          title="Sign Stake"
          :before-change="() => signature !== null"
        >
          <b-card
            title="Sign Stake with Zelcore"
            class="text-center wizard-card"
          >
            <a
              :href="(stakeRegistered || registeringStake || stakeRegisterFailed) ? '#' : `zel:?action=sign&message=${dataToSign}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue()}`"
              @click="initiateSignWS"
            >
              <img
                class="zelidLogin mb-2"
                src="@/assets/images/zelID.svg"
                alt="Zel ID"
                height="100%"
                width="100%"
              >
            </a>
            <b-form-input
              id="data"
              v-model="dataToSign"
              :disabled="true"
              class="mb-1"
            />
            <b-form-input
              id="signature"
              v-model="signature"
              :disabled="stakeRegistered || registeringStake || stakeRegisterFailed"
            />
          </b-card>
        </tab-content>
        <tab-content
          title="Send Stake"
          :before-change="() => stakeRegistered === true"
        >
          <b-card
            title="Send edited Stake to Titan"
            class="text-center wizard-card"
          >
            <div class="mt-3 mb-auto ">
              <b-button
                size="lg"
                :disabled="registeringStake || stakeRegistered"
                variant="success"
                @click="sendModifiedStake"
              >
                Send Stake
              </b-button>
              <h4
                v-if="stakeRegistered"
                class="mt-3 text-success"
              >
                Edited Stake received
              </h4>
              <h4
                v-if="stakeRegisterFailed"
                class="mt-3 text-danger"
              >
                Stake editing failed
              </h4>
            </div>
          </b-card>
        </tab-content>
      </form-wizard>
    </b-modal>

    <!-- Stake Dialog -->
    <b-modal
      v-model="stakeModalShowing"
      title="Stake Flux with Titan"
      size="lg"
      centered
      no-close-on-backdrop
      no-close-on-esc
      button-size="sm"
      ok-only
      ok-title="Cancel"
      @ok="confirmStakeDialogCancel"
    >
      <form-wizard
        :color="tierColors.cumulus"
        :title="null"
        :subtitle="null"
        layout="vertical"
        back-button-text="Previous"
        class="wizard-vertical mb-3"
        @on-complete="confirmStakeDialogFinish()"
      >
        <tab-content
          title="Stake Amount"
        >
          <b-card
            v-if="reinvestingNewStake"
            title="Re-investing Funds"
            class="text-center wizard-card"
          >
            <div>
              <h5
                class="mt-3"
              >
                A new stake will be created using your available rewards:
              </h5>
              <h2
                class="mt-3"
              >
                {{ toFixedLocaleString(totalReward, 2) }} Flux
              </h2>
              <div
                v-if="titanConfig && titanConfig.reinvestFee > 0 && titanConfig.maxReinvestFee"
                class="mt-2"
              >
                <h6>
                  <span class="text-warning">Re-invest Fee:</span>
                  <span
                    v-b-tooltip.hover.bottom="`Fee of ${titanConfig.reinvestFee}% of your rewards, capped at ${titanConfig.maxReinvestFee} Flux`"
                    class="text-danger"
                  > {{ toFixedLocaleString(calculateNewStakeReinvestFee(), 8) }} Flux
                  </span>
                </h6>
              </div>
            </div>
          </b-card>
          <b-card
            v-else
            title="Choose Stake Amount"
            class="text-center wizard-card"
          >
            <div>
              <h3 class="float-left">
                {{ toFixedLocaleString(minStakeAmount) }}
              </h3>
              <h3 class="float-right">
                {{ toFixedLocaleString(maxStakeAmount) }}
              </h3>
            </div>
            <b-form-input
              id="stakeamount"
              v-model="stakeAmount"
              type="range"
              :min="minStakeAmount"
              :max="maxStakeAmount"
              step="5"
              number
              :disabled="stakeRegistered || registeringStake || stakeRegisterFailed"
            />
            <b-form-spinbutton
              id="stakeamount-spnner"
              v-model="stakeAmount"
              :min="minStakeAmount"
              :max="maxStakeAmount"
              size="lg"
              :formatter-fn="toFixedLocaleString"
              :disabled="stakeRegistered || registeringStake || stakeRegisterFailed"
              class="stakeAmountSpinner"
            />
          </b-card>
        </tab-content>
        <tab-content
          title="Choose Duration"
          :before-change="() => checkDuration()"
        >
          <b-card
            v-if="titanConfig"
            title="Select Lockup Period"
            class="text-center wizard-card"
          >
            <div
              v-for="(lockup, index) in titanConfig.lockups"
              :key="lockup.time"
              class="mb-1"
            >
              <div class="ml-auto mr-auto">
                <b-button
                  :class="(index === selectedLockupIndex ? 'selectedLockupButton' : 'unselectedLockupButton') + (reinvestingNewStake ? 'Small' : '')"
                  :style="`background-color: ${indexedTierColors[index]} !important;`"
                  :disabled="stakeRegistered || registeringStake || stakeRegisterFailed"
                  @click="selectLockup(index)"
                >
                  {{ lockup.name }} - ~{{ (lockup.apr*100).toFixed(2) }}%
                </b-button>
              </div>
            </div>
            <div class="d-flex">
              <b-form-checkbox
                v-model="autoReinvestStake"
                :disabled="stakeRegistered || registeringStake || stakeRegisterFailed"
                class="ml-auto mr-auto"
                style="float: left;"
              >
                Auto-reinvest this stake after expiry
              </b-form-checkbox>
            </div>
          </b-card>
        </tab-content>
        <tab-content
          title="Sign Stake"
          :before-change="() => signature !== null"
        >
          <b-card
            title="Sign Stake with Zelcore"
            class="text-center wizard-card"
          >
            <a
              :href="(stakeRegistered || registeringStake || stakeRegisterFailed) ? '#' : `zel:?action=sign&message=${dataToSign}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue()}`"
              @click="initiateSignWS"
            >
              <img
                class="zelidLogin mb-2"
                src="@/assets/images/zelID.svg"
                alt="Zel ID"
                height="100%"
                width="100%"
              >
            </a>
            <b-form-input
              id="data"
              v-model="dataToSign"
              :disabled="true"
              class="mb-1"
            />
            <b-form-input
              id="signature"
              v-model="signature"
              :disabled="stakeRegistered || registeringStake || stakeRegisterFailed"
            />
          </b-card>
        </tab-content>
        <tab-content
          title="Register Stake"
          :before-change="() => stakeRegistered === true"
        >
          <b-card
            title="Register Stake with Titan"
            class="text-center wizard-card"
          >
            <div class="mt-3 mb-auto ">
              <h5>
                <span class="text-danger">IMPORTANT:</span> Your funds will be locked until
              </h5>
              <h5>
                <span class="text-warning">{{ new Date(new Date().getTime() + (getLockupDuration()*1000)).toLocaleString() }}</span>
              </h5>
              <h5 class="mb-2">
                You will not be able to withdraw your staked Flux until your stake has expired.
              </h5>
              <b-button
                size="lg"
                :disabled="registeringStake || stakeRegistered"
                variant="success"
                @click="registerStake"
              >
                Register Stake
              </b-button>
              <h4
                v-if="stakeRegistered"
                class="mt-3 text-success"
              >
                Registration received
              </h4>
              <h4
                v-if="stakeRegisterFailed"
                class="mt-3 text-danger"
              >
                Registration failed
              </h4>
            </div>
          </b-card>
        </tab-content>
        <tab-content
          v-if="!reinvestingNewStake"
          title="Send Funds"
        >
          <div
            v-if="titanConfig && signatureHash"
          >
            <b-card
              title="Send Funds"
              class="text-center wizard-card"
            >
              <b-card-text>
                To finish staking, make a transaction of <span class="text-success">{{ toFixedLocaleString(stakeAmount) }}</span> FLUX to address<br>
                <h5
                  class="text-wrap ml-auto mr-auto text-warning"
                  style="width: 25rem;"
                >
                  {{ titanConfig.fundingAddress }}
                </h5>
                with the following message<br>
              </b-card-text>
              <h5
                class="text-wrap ml-auto mr-auto text-warning"
                style="width: 25rem;"
              >
                {{ signatureHash }}
              </h5>
              <div class="d-flex flex-row mt-2">
                <h3 class="col text-center mt-2">
                  Pay with<br>Zelcore
                </h3>
                <a
                  :href="`zel:?action=pay&coin=zelcash&address=${titanConfig.fundingAddress}&amount=${stakeAmount}&message=${signatureHash}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png`"
                  class="col"
                >
                  <img
                    class="zelidLogin"
                    src="@/assets/images/zelID.svg"
                    alt="Zel ID"
                    height="100%"
                    width="100%"
                  >
                </a>
              </div>
            </b-card>
          </div>
        </tab-content>
      </form-wizard>
    </b-modal>
  </div>
</template>

<script>
import {
  BAvatar,
  BButton,
  BCard,
  BCardBody,
  // BCardHeader,
  BCardText,
  BCardTitle,
  BCol,
  BFormCheckbox,
  BFormInput,
  BFormSelect,
  BFormSelectOption,
  BFormSpinbutton,
  BMedia,
  BMediaBody,
  BModal,
  BOverlay,
  BRow,
  BSpinner,
  BTabs,
  BTab,
  BTable,
  VBModal,
  VBToggle,
  VBTooltip,
} from 'bootstrap-vue';
import {
  FormWizard,
  TabContent,
} from 'vue-form-wizard';
import VuePerfectScrollbar from 'vue-perfect-scrollbar';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification/composition';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';

import 'vue-form-wizard/dist/vue-form-wizard.min.css';

import {
  ref,
  computed,
} from '@vue/composition-api';

import axios from 'axios';

import tierColors from '@/libs/colors';
import DashboardService from '@/services/DashboardService';

const qs = require('qs');
const store = require('store');
const timeoptions = require('@/libs/dateFormat');

export default {
  components: {
    BAvatar,
    BButton,
    BCard,
    BCardBody,
    // BCardHeader,
    BCardText,
    BCardTitle,
    BCol,
    BFormCheckbox,
    BFormInput,
    BFormSelect,
    BFormSelectOption,
    BFormSpinbutton,
    BMedia,
    BMediaBody,
    BModal,
    BOverlay,
    BRow,
    BSpinner,
    BTabs,
    BTab,
    BTable,

    FormWizard,
    TabContent,

    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,

    // 3rd Party
    VuePerfectScrollbar,
  },
  directives: {
    Ripple,
    'b-modal': VBModal,
    'b-toggle': VBToggle,
    'b-tooltip': VBTooltip,
  },
  props: {
    zelid: {
      type: String,
      required: false,
      default: '',
    },
  },
  setup(props, ctx) {
    // Use toast
    const toast = useToast();
    const showToast = (variant, title, icon = 'InfoIcon') => {
      toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
        position: 'bottom-right',
      });
    };

    const tier = ref('');
    tier.value = props.tier;
    const userZelid = ref('');
    userZelid.value = props.zelid;

    const apiURL = 'https://titan.runonflux.io';

    const totalReward = ref(0);
    const totalRewardForFee = ref(0);
    const stakeAmount = ref(50);
    const minStakeAmount = ref(50);
    const maxStakeAmount = ref(1000);
    const selectedLockupIndex = ref(0);
    const dataToSign = ref(null);
    const signature = ref(null);
    const signatureHash = ref(null);
    const timestamp = ref(null);
    const websocket = ref(null);
    const stakeRegistered = ref(false);
    const stakeRegisterFailed = ref(false);
    const registeringStake = ref(false);
    const config = computed(() => ctx.root.$store.state.flux.config);
    const selectedStake = ref(null);
    const autoReinvestStake = ref(true);
    const reinvestingNewStake = ref(false);
    const tooMuchStaked = ref(true); // the Stake Flux button will be disabled until we determine it can be enabled
    const defaultStakeDisabledMessage = ref('Too much Flux has staked, please wait for more Nodes to be made available');

    const redeemAmount = ref(0);
    const redeemAddress = ref(null);
    const redeemAddresses = ref(null);
    const requestSent = ref(false);
    const requestFailed = ref(false);
    const sendingRequest = ref(false);

    const indexedTierColors = ref([
      tierColors.cumulus,
      tierColors.nimbus,
      tierColors.stratus,
    ]);

    const backend = () => {
      const { protocol, hostname } = window.location;
      let mybackend = '';
      mybackend += protocol;
      mybackend += '//';
      const regex = /[A-Za-z]/g;
      if (hostname.match(regex)) {
        const names = hostname.split('.');
        names[0] = 'api';
        mybackend += names.join('.');
      } else {
        if (typeof hostname === 'string') {
          ctx.root.$store.commit('flux/setUserIp', hostname);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += config.value.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      return backendURL;
    };

    const callbackValue = () => {
      const backendURL = backend();
      const url = `${backendURL}/id/providesign`;
      return encodeURI(url);
    };

    const onError = (evt) => {
      console.log(evt);
    };
    const onMessage = (evt) => {
      const data = qs.parse(evt.data);
      if (data.status === 'success' && data.data) {
        // user is now signed. Store their values
        signature.value = data.data.signature;
      }
      console.log(data);
      console.log(evt);
    };
    const onClose = (evt) => {
      console.log(evt);
    };
    const onOpen = (evt) => {
      console.log(evt);
    };

    const initiateSignWS = () => {
      if (stakeRegistered.value || registeringStake.value || stakeRegisterFailed.value) {
        return;
      }
      const { protocol, hostname } = window.location;
      let mybackend = '';
      mybackend += protocol;
      mybackend += '//';
      const regex = /[A-Za-z]/g;
      if (hostname.match(regex)) {
        const names = hostname.split('.');
        names[0] = 'api';
        mybackend += names.join('.');
      } else {
        if (typeof hostname === 'string') {
          ctx.root.$store.commit('flux/setUserIp', hostname);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += config.value.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const signatureMessage = userZelid.value + timestamp.value;
      console.log(`signatureMessage: ${signatureMessage}`);
      const wsuri = `${backendURL}/ws/sign/${signatureMessage}`;
      console.log(wsuri);
      const ws = new WebSocket(wsuri);
      websocket.value = ws;

      ws.onopen = (evt) => { onOpen(evt); };
      ws.onclose = (evt) => { onClose(evt); };
      ws.onmessage = (evt) => { onMessage(evt); };
      ws.onerror = (evt) => { onError(evt); };
    };

    // Variables to control showing dialogs
    const stakeModalShowing = ref(false);
    const confirmStakeDialogCloseShowing = ref(false);
    const confirmStakeDialogFinishShowing = ref(false);
    const paymentDetailsDialogShowing = ref(false);
    const nodeModalShowing = ref(false);
    const aprModalShowing = ref(false);
    const redeemModalShowing = ref(false);
    const reinvestModalShowing = ref(false);
    const activeStakeInfoModalShowing = ref(false);
    const editStakeModalShowing = ref(false);

    const perfectScrollbarSettings = {
      maxScrollbarLength: 150,
    };

    const nodes = ref([]);
    const totalCollateral = ref(0);
    const myStakes = ref([]);
    const myExpiredStakes = ref([]);
    const myPayments = ref([]);
    const paymentFields = ref([
      {
        key: 'timestamp',
        label: 'Date',
      },
      {
        key: 'total',
        label: 'Amount',
      },
      {
        key: 'address',
        label: 'Address',
      },
      {
        key: 'txid',
        label: 'Transaction',
      },
    ]);
    const titanConfig = ref();
    const titanStats = ref();
    const nodeCount = ref(0);

    const getRegistrationMessage = async () => {
      const response = await axios.get(`${apiURL}/registermessage`);
      dataToSign.value = response.data;
      timestamp.value = response.data.substring(response.data.length - 13);
      // console.log(dataToSign.value);
    };

    const getRedeemMessage = async () => {
      const response = await axios.get(`${apiURL}/redeemmessage`);
      dataToSign.value = response.data;
      timestamp.value = response.data.substring(response.data.length - 13);
    };

    const getModifyMessage = async () => {
      const response = await axios.get(`${apiURL}/modifymessage`);
      dataToSign.value = response.data;
      timestamp.value = response.data.substring(response.data.length - 13);
    };

    const checkRedeemAddress = async () => {
      if (!redeemAddress.value) return false;
      await getRedeemMessage();
      return true;
    };

    const getStats = async () => {
      const response = await axios.get(`${apiURL}/stats`);
      titanStats.value = response.data;

      tooMuchStaked.value = (totalCollateral.value <= (titanStats.value.total + titanConfig.value.minStake));
    };

    const getSharedNodeList = async () => {
      const response = await axios.get(`${apiURL}/nodes`);
      const allNodes = [];
      totalCollateral.value = 0;
      response.data.forEach((_node) => {
        const node = _node;
        allNodes.push(node);
        totalCollateral.value += node.collateral;
      });
      // console.log(allNodes);
      nodes.value = allNodes.sort((a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1));
    };

    const getMyStakes = async (force = false) => {
      if (userZelid.value.length > 0) {
        const response = await axios.get(`${apiURL}/stakes/${userZelid.value}${force ? `?timestamp=${Date.now()}` : ''}`);
        const activeStakes = [];
        const expiredStakes = [];
        const now = Date.now() / 1000;
        totalReward.value = 0;
        totalRewardForFee.value = 0;
        response.data.forEach((stake) => {
          if (stake.expiry < now) {
            if (stake.state >= 4) { // ensure that only expired or completed stakes are in the Expired list
              expiredStakes.push(stake);
              if (stake.state === 4) { // include the expired stake's actual reward for fee calculation
                totalRewardForFee.value += (stake.reward - stake.collateral);
              }
            }
          } else {
            activeStakes.push(stake);
            totalRewardForFee.value += stake.reward;
          }
          totalReward.value += stake.reward;
        });
        myStakes.value = activeStakes;
        myExpiredStakes.value = expiredStakes;
      }
    };

    const getMyPayments = async (force = false) => {
      if (userZelid.value.length > 0) {
        const response = await axios.get(`${apiURL}/payments/${userZelid.value}${force ? `?timestamp=${Date.now()}` : ''}`);
        myPayments.value = response.data;
      }
    };

    const getNodeCount = async () => {
      const response = await DashboardService.zelnodeCount();
      if (response.data.status === 'error') {
        showToast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        });
        return 0;
      }
      const fluxNodesData = response.data.data;
      return fluxNodesData['stratus-enabled'];
    };

    const calcAPR = (lockup) => {
      const fluxPerBlockReward = (22.5 * (100 - lockup.fee)) / 100;
      const collateral = 40000;
      const blocksPerDay = 720;
      const numStratusNodes = nodeCount.value;
      const payoutFrequency = blocksPerDay / numStratusNodes;
      const fluxPerMonth = (30 * payoutFrequency) * fluxPerBlockReward;
      const rewardPerSeat = (fluxPerMonth / collateral);
      const rewardPerYear = (rewardPerSeat * 12);
      const apr = ((1 + rewardPerYear / 12) ** 12) - 1;
      return apr;
    };

    const showOverlay = () => {
      if (titanConfig.value && titanConfig.value.maintenanceMode) {
        return true;
      }
      return false;
    };

    const fetchData = async () => {
      try {
        nodeCount.value = await getNodeCount();
        const response = await axios.get(`${apiURL}/config`);
        titanConfig.value = response.data;
        titanConfig.value.lockups.sort((a, b) => a.blocks - b.blocks);
        titanConfig.value.lockups.forEach((lockup) => {
          // eslint-disable-next-line no-param-reassign
          lockup.apr = calcAPR(lockup);
        });
        if (response.data.minStake > 0) {
          minStakeAmount.value = response.data.minStake;
        }
        if (response.data.maxStake > 0) {
          maxStakeAmount.value = response.data.maxStake;
        }
        await getSharedNodeList();
        await getStats();
        getMyStakes();
        getMyPayments();
        if (totalCollateral.value - titanStats.value.total < maxStakeAmount.value) {
          maxStakeAmount.value = totalCollateral.value - titanStats.value.total;
        }
      } catch (error) {
        showToast('danger', error.message || error);
      }
    };
    fetchData();

    setInterval(() => {
      fetchData();
    }, 2 * 60 * 1000);

    const showStakeDialog = (reinvesting = false) => {
      if (titanConfig.value && titanConfig.value.maintenanceMode) return;
      reinvestingNewStake.value = reinvesting;
      stakeModalShowing.value = true;
      stakeRegistered.value = false;
      stakeRegisterFailed.value = false;
      registeringStake.value = false;
      stakeAmount.value = minStakeAmount.value;
      selectedLockupIndex.value = 0;
      signature.value = null;
      signatureHash.value = null;
    };

    const confirmStakeDialogFinish = () => {
      if (reinvestingNewStake.value) {
        // if this is a re-investment, no need to show the payment details reminder dialog
        stakeModalShowing.value = false;
      } else {
        confirmStakeDialogFinishShowing.value = true;
      }
      getMyStakes(true);
    };

    const confirmStakeDialogCancel = (modalEvt) => {
      modalEvt.preventDefault();
      confirmStakeDialogCloseShowing.value = true;
    };

    const showActiveStakeInfoDialog = (stake) => {
      if (titanConfig.value && titanConfig.value.maintenanceMode) return;
      selectedStake.value = JSON.parse(JSON.stringify(stake));
      activeStakeInfoModalShowing.value = true;
    };

    const editActiveStake = async () => {
      if (titanConfig.value && titanConfig.value.maintenanceMode) return;
      activeStakeInfoModalShowing.value = false;
      await getModifyMessage();
      stakeRegistered.value = false;
      stakeRegisterFailed.value = false;
      registeringStake.value = false;
      signature.value = null;
      signatureHash.value = null;
      editStakeModalShowing.value = true;
    };

    const sendModifiedStake = async () => {
      registeringStake.value = true;
      const zelidauthHeader = localStorage.getItem('zelidauth');
      const data = {
        stake: selectedStake.value.uuid,
        timestamp: timestamp.value,
        signature: signature.value,
        data: dataToSign.value,
        autoreinvest: selectedStake.value.autoreinvest,
        reinvest: false,
      };
      showToast('info', 'Sending modified Stake to Titan...');

      const axiosConfig = {
        headers: {
          zelidauth: zelidauthHeader,
          backend: backend(), // include the backend URL, so the titan backend can communicate with the same FluxOS instance
        },
      };
      const response = await axios.post(`${apiURL}/modifystake`, data, axiosConfig).catch((error) => {
        console.log(error);
        stakeRegisterFailed.value = true;
        showToast('danger', error.message || error);
      });

      console.log(response.data);
      if (response && response.data && response.data.status === 'success') {
        stakeRegistered.value = true;
        showToast('success', response.data.message || response.data);
      } else {
        stakeRegisterFailed.value = true;
        showToast('danger', (response.data.data ? response.data.data.message : response.data.message) || response.data);
      }
    };

    const showReinvestDialog = (stake) => {
      if (titanConfig.value && titanConfig.value.maintenanceMode) return;
      stakeRegistered.value = false;
      stakeRegisterFailed.value = false;
      registeringStake.value = false;
      selectedLockupIndex.value = 0;
      signature.value = null;
      signatureHash.value = null;
      selectedStake.value = JSON.parse(JSON.stringify(stake));
      getModifyMessage();
      reinvestModalShowing.value = true;
    };

    const reinvestDialogFinish = () => {
      getMyStakes(true);
      reinvestModalShowing.value = false;
    };

    const calculateReinvestFee = () => {
      const actualReward = (selectedStake.value.reward - selectedStake.value.collateral);
      let fee = actualReward * (titanConfig.value.reinvestFee / 100);
      if (fee > titanConfig.value.maxReinvestFee) {
        fee = titanConfig.value.maxReinvestFee;
      }
      return fee;
    };

    const calculateNewStakeReinvestFee = () => {
      const actualReward = totalRewardForFee.value;
      let fee = actualReward * (titanConfig.value.reinvestFee / 100);
      if (fee > titanConfig.value.maxReinvestFee) {
        fee = titanConfig.value.maxReinvestFee;
      }
      return fee;
    };

    const calculateRedeemFee = () => {
      if (!titanConfig.value) return 0;
      if (!titanConfig.value.maxRedeemFee) {
        return titanConfig.value.redeemFee;
      }
      const actualReward = totalRewardForFee.value;
      let fee = actualReward * (titanConfig.value.redeemFee / 100);
      if (fee > titanConfig.value.maxRedeemFee) {
        fee = titanConfig.value.maxRedeemFee;
      }
      return fee;
    };

    const selectLockup = (lockupIndex) => {
      selectedLockupIndex.value = lockupIndex;
    };

    const showNodeInfoDialog = () => {
      if (titanConfig.value && titanConfig.value.maintenanceMode) return;
      nodeModalShowing.value = true;
    };

    const showAPRInfoDialog = () => {
      if (titanConfig.value && titanConfig.value.maintenanceMode) return;
      aprModalShowing.value = true;
    };

    const showRedeemDialog = () => {
      if (titanConfig.value && titanConfig.value.maintenanceMode) return;
      const addresses = [];
      myStakes.value.forEach((stake) => {
        if (stake.address && !addresses.some((address) => address.text === stake.address)) {
          addresses.push({
            value: stake.uuid,
            text: stake.address,
          });
        }
      });
      myExpiredStakes.value.forEach((stake) => {
        if (stake.address && !addresses.some((address) => address.text === stake.address)) {
          addresses.push({
            value: stake.uuid,
            text: stake.address,
          });
        }
      });
      redeemAmount.value = titanConfig.value.redeemFee;
      redeemAddress.value = null;
      redeemAddresses.value = addresses;
      dataToSign.value = null;
      signature.value = null;
      sendingRequest.value = false;
      requestSent.value = false;
      requestFailed.value = false;
      redeemModalShowing.value = true;
    };

    const confirmRedeemDialogFinish = () => {
      if (titanConfig.value && titanConfig.value.maintenanceMode) return;
      redeemModalShowing.value = false;
      getMyStakes(true);
      getMyPayments(true);
    };

    const showPaymentDetailsDialog = (stake) => {
      if (titanConfig.value && titanConfig.value.maintenanceMode) return;
      selectedStake.value = JSON.parse(JSON.stringify(stake));
      paymentDetailsDialogShowing.value = true;
    };

    const reinvestStake = async () => {
      registeringStake.value = true;
      const zelidauthHeader = localStorage.getItem('zelidauth');
      const data = {
        stake: selectedStake.value.uuid,
        timestamp: timestamp.value,
        signature: signature.value,
        data: dataToSign.value,
        autoreinvest: selectedStake.value.autoreinvest,
        reinvest: true,
        lockup: titanConfig.value.lockups[selectedLockupIndex.value],
      };
      showToast('info', 'Re-investing Stake with Titan...');

      const axiosConfig = {
        headers: {
          zelidauth: zelidauthHeader,
          backend: backend(), // include the backend URL, so the titan backend can communicate with the same FluxOS instance
        },
      };
      const response = await axios.post(`${apiURL}/modifystake`, data, axiosConfig).catch((error) => {
        console.log(error);
        stakeRegisterFailed.value = true;
        showToast('danger', error.message || error);
      });

      console.log(response.data);
      if (response && response.data && response.data.status === 'success') {
        stakeRegistered.value = true;
        showToast('success', response.data.message || response.data);
      } else {
        stakeRegisterFailed.value = true;
        showToast('danger', (response.data.data ? response.data.data.message : response.data.message) || response.data);
      }
    };

    const registerStake = async () => {
      registeringStake.value = true;
      const zelidauthHeader = localStorage.getItem('zelidauth');
      const data = {
        amount: reinvestingNewStake.value ? 0 : stakeAmount.value,
        lockup: titanConfig.value.lockups[selectedLockupIndex.value],
        timestamp: timestamp.value,
        signature: signature.value,
        data: dataToSign.value,
        autoreinvest: autoReinvestStake.value,
        stakefromrewards: reinvestingNewStake.value,
      };
      showToast('info', 'Registering Stake with Titan...');

      const axiosConfig = {
        headers: {
          zelidauth: zelidauthHeader,
          backend: backend(), // include the backend URL, so the titan backend can communicate with the same FluxOS instance
        },
      };
      const response = await axios.post(`${apiURL}/register`, data, axiosConfig).catch((error) => {
        console.log(error);
        stakeRegisterFailed.value = true;
        showToast('danger', error.message || error);
      });

      console.log(response.data);
      if (response && response.data && response.data.status === 'success') {
        stakeRegistered.value = true;
        signatureHash.value = response.data.hash;
        showToast('success', response.data.message || response.data);
      } else {
        stakeRegisterFailed.value = true;
        showToast('danger', (response.data.data ? response.data.data.message : response.data.message) || response.data);
      }
    };

    const toFixedLocaleString = (number, digits = 0) => {
      const roundedDown = Math.floor(number * (10 ** digits)) / (10 ** digits);
      if (digits < 4) {
        return roundedDown.toLocaleString();
      }
      return `${roundedDown}`;
    };

    const requestRedeem = async () => {
      sendingRequest.value = true;
      const zelidauthHeader = localStorage.getItem('zelidauth');
      const data = {
        amount: totalReward.value,
        stake: redeemAddress.value,
        timestamp: timestamp.value,
        signature: signature.value,
        data: dataToSign.value,
      };
      console.log(data);

      showToast('info', 'Sending redeem request to Titan...');

      const axiosConfig = {
        headers: {
          zelidauth: zelidauthHeader,
          backend: backend(), // include the backend URL, so the titan backend can communicate with the same FluxOS instance
        },
      };
      const response = await axios.post(`${apiURL}/redeem`, data, axiosConfig).catch((error) => {
        console.log(error);
        requestFailed.value = true;
        showToast('danger', error.message || error);
      });

      console.log(response.data);
      if (response && response.data && response.data.status === 'success') {
        requestSent.value = true;
        showToast('success', response.data.message || response.data);
        fetchData();
      } else {
        requestFailed.value = true;
        showToast('danger', (response.data.data ? response.data.data.message : response.data.message) || response.data);
      }
    };

    const calcMonthlyReward = (stake) => {
      const lockup = titanConfig.value.lockups.find((aLockup) => aLockup.fee === stake.fee);
      if (!lockup) return 0;
      return ((stake.collateral) * lockup.apr) / 12;
    };

    const calculatePaidRewards = () => {
      let paid = myStakes.value ? myStakes.value.reduce((total, stake) => total + stake.paid - (stake.feePaid ?? 0), 0) : 0;
      paid += myExpiredStakes.value ? myExpiredStakes.value.reduce((total, stake) => total + stake.paid - (stake.feePaid ?? 0) - (stake.state === 5 ? stake.collateral : 0), 0) : 0;
      return toFixedLocaleString(paid, 2);
    };

    const visitNode = (node) => {
      window.open(`http://${node.address}`, '_blank');
    };

    const checkDuration = async () => {
      await getRegistrationMessage();
      return selectedLockupIndex.value >= 0 && selectedLockupIndex.value < titanConfig.value.lockups.length;
    };

    const getLockupDuration = () => {
      if (titanConfig.value) {
        return titanConfig.value.lockups[selectedLockupIndex.value].time;
      }
      return 0;
    };

    const checkReinvestDuration = async () => (selectedLockupIndex.value >= 0 && selectedLockupIndex.value < titanConfig.value.lockups.length);

    const redeemAmountState = () => {
      console.log(redeemAmount.value);
      const amount = parseFloat(redeemAmount.value);
      console.log(amount);
      console.log(totalReward.value);
      return amount > titanConfig.value.redeemFee && amount <= parseFloat(toFixedLocaleString(totalReward.value, 2));
    };

    const formatPaymentTooltip = (stake) => `Send a payment of ${stake.collateral} Flux to<br>${titanConfig.nodeAddress}<br>with a message<br>${stake.signatureHash}`;

    return {

      // UI
      perfectScrollbarSettings,

      timeoptions,

      nodes,
      totalCollateral,
      myStakes,
      myExpiredStakes,
      myPayments,
      paymentFields,
      totalReward,
      titanConfig,
      titanStats,
      tooMuchStaked,
      defaultStakeDisabledMessage,

      userZelid,
      signature,
      signatureHash,
      dataToSign,
      callbackValue,
      initiateSignWS,
      timestamp,

      getMyStakes,
      getMyPayments,

      calcAPR,
      calcMonthlyReward,
      calculatePaidRewards,

      toFixedLocaleString,
      formatPaymentTooltip,

      showNodeInfoDialog,
      nodeModalShowing,
      visitNode,

      showAPRInfoDialog,
      aprModalShowing,

      stakeModalShowing,
      showStakeDialog,
      reinvestingNewStake,
      stakeAmount,
      minStakeAmount,
      maxStakeAmount,
      stakeRegistered,
      stakeRegisterFailed,
      selectedLockupIndex,
      selectLockup,
      autoReinvestStake,
      registeringStake,
      registerStake,
      checkDuration,
      getLockupDuration,
      getRegistrationMessage,

      confirmStakeDialogCancel,
      confirmStakeDialogCloseShowing,
      confirmStakeDialogFinish,
      confirmStakeDialogFinishShowing,

      showActiveStakeInfoDialog,
      activeStakeInfoModalShowing,
      editActiveStake,
      editStakeModalShowing,
      sendModifiedStake,

      showReinvestDialog,
      getModifyMessage,
      reinvestModalShowing,
      reinvestStake,
      checkReinvestDuration,
      reinvestDialogFinish,
      calculateReinvestFee,
      calculateNewStakeReinvestFee,

      showPaymentDetailsDialog,
      paymentDetailsDialogShowing,
      selectedStake,

      showOverlay,

      showRedeemDialog,
      redeemModalShowing,
      redeemAmount,
      redeemAddress,
      redeemAddresses,
      redeemAmountState,
      getRedeemMessage,
      checkRedeemAddress,
      sendingRequest,
      requestSent,
      requestFailed,
      requestRedeem,
      confirmRedeemDialogFinish,
      calculateRedeemFee,

      tierColors,
      indexedTierColors,
    };
  },
};
</script>

<style scoped>
.inline {
  display: inline;
  padding-left: 5px;
}
.zelidLogin {
  height: 100px;
}
.zelidLogin img {
  -webkit-app-region: no-drag;
  transition: 0.1s;
}

a img {
  transition: all 0.05s ease-in-out;
}

a:hover img {
  filter: opacity(70%);
  transform: scale(1.1);
}
.text-decoration-line-through {
  text-decoration: line-through;
}
.wizard-card {
  height: 250px;
}
.payment-details-card {
  height: 375px;
}
.node-status {
  margin-right: 0px;
  margin-left: 0;
}
.stakes-title {
  margin-left: 10px;
  margin-top: 10px;
}
.seat-column {
  padding-left: 0;
  padding-right: 0;
}

.stakeAmountSpinner {
  font-size: 40px;
  width: 250px;
  margin-left: auto;
  margin-right: auto;
  margin-top: 2rem;
}

.selectedLockupButton {
  border-color: red !important;
  border: 5px solid;
  height: 60px;
  width: 300px;
  font-size: 20px;
}

.unselectedLockupButtonSmall {
  border-color: transparent;
  border: 0px solid;
  height: 50px;
  width: 300px;
  font-size: 20px;
}

.selectedLockupButtonSmall {
  border-color: red !important;
  border: 5px solid;
  height: 50px;
  width: 300px;
  font-size: 20px;
}

.unselectedLockupButton {
  border-color: transparent;
  border: 0px solid;
  height: 60px;
  width: 300px;
  font-size: 20px;
}

.active-node-value {
  font-size: 7em;
  text-align: center;
  padding-bottom: 1.5rem;
}
.active-node-value-xl {
  font-size: 6em;
  text-align: center;
  padding-bottom: 0;
  margin-bottom: 0;
}
.shared-node-info-title {
  padding: 1.5rem;
}
.shared-node-info-body {
  padding-top: 0;
  padding-bottom: 0.3rem;
}
.shared-node-info-title-xl {
  padding: 1.5rem;
  padding-bottom: 1rem;
}
.shared-node-info-body-xl {
  padding-top: 0;
  padding-bottom: 0.1rem;
}

.lockup {
  margin-bottom: 0.5rem;
}

</style>
<style lang="scss">
  @import '@core/scss/vue/libs/vue-wizard.scss';
</style>
