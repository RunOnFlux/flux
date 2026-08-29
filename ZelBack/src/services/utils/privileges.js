/**
 * The privileges a route may require.
 *
 * Each names a set of identities and asks whether the caller is one of them.
 * None requires two identities at once, which is why every compound reads OR.
 *
 * The values are the wire vocabulary and are not ours to choose: /id/checkprivilege
 * answers three of them to clients, and the frontend branches on those strings in
 * a separately deployed repo. The names are ours, and they are what every call
 * site reads.
 *
 * This module holds values and requires nothing, so it can be imported at the top
 * of any file - including those that reach verificationHelper through a dynamic
 * require to break a cycle.
 */
const Privilege = Object.freeze({
  // Any FluxID with a valid signature and a live session.
  USER: 'user',
  // The operator of THIS node, from config `initial.zelid`. They administer
  // hardware; nothing about a customer's application follows from that.
  NODE_OPERATOR: 'admin',
  // Two identities: the flux team and flux support.
  FLUX_TEAM: 'fluxteam',
  NODE_OPERATOR_OR_FLUX_TEAM: 'adminandfluxteam',
  // The FluxID that registered the application.
  APP_OWNER: 'appowner',
  APP_OWNER_OR_FLUX_TEAM: 'appownerorfluxteam',
});

/**
 * The privileges whose question is about an application rather than an identity
 * alone. They are the only ones that read an app name, and the only ones that
 * may be given one.
 *
 * An array rather than a Set, because Object.freeze does not freeze a Set: its
 * contents are not own properties, so a frozen Set still accepts an add().
 */
const APP_SCOPED = Object.freeze([Privilege.APP_OWNER, Privilege.APP_OWNER_OR_FLUX_TEAM]);

module.exports = { Privilege, APP_SCOPED };
