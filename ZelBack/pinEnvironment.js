// What the process settles about itself before any library reads the environment.
//
// Required as the FIRST line of every entry point. node-config, express and apicache each
// read these as they load, so a require placed above this one that reaches any of them
// answers the question first and the pins below arrive too late to matter.
//
// The four belong together. NODE_ENV and NODE_CONFIG_ENV in particular are a pair: pinning
// NODE_ENV alone sends node-config looking for a deployment file that does not exist.

process.env.NODE_CONFIG_DIR = `${__dirname}/config/`;
// The directory is pinned above so config loads from the one that ships with the node.
// NODE_CONFIG is the same door: the config package merges whatever JSON it holds over every
// file, after the directory is settled, so leaving it open redirects any endpoint without
// editing a single file. Deleted rather than emptied, because an empty value is parsed and
// fails rather than being ignored.
delete process.env.NODE_CONFIG;

// The same door, one variable over. Express hands a caller the exception stack instead of
// the status text unless this says production, and apicache stamps its version onto every
// cached response. Assigned rather than defaulted, because a value read from the
// environment changes how the node answers without any file saying so.
process.env.NODE_ENV = 'production';

// node-config names its deployment from the environment too, preferring this variable to
// NODE_ENV. Pinned to the deployment it already resolves to, so the line above governs
// express and apicache alone: the config directory holds one file, default.js, and
// node-config warns on every start for a deployment name it cannot find a file for.
process.env.NODE_CONFIG_ENV = 'development';
