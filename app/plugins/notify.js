"use strict";

/**
 * @help Adds NOTIFY [RFC5465] capability
 */

module.exports = function (server) {
  server.registerCapability("NOTIFY");

  server.notifiable = true;
};