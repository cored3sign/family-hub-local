// Yjs transaction origins shared by the modules that write and send the family data.
// This file imports nothing, so the relay tests can load it under plain Node.

// Device-list writes. The relay shares them like any change, but sends no notification.
export const PRESENCE_ORIGIN = 'presence'
// Changes another device made, as the relay delivers them to this one.
export const RELAY_REMOTE_ORIGIN = 'relay-remote'
