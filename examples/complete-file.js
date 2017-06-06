var hoodiecrow = require("./app/server"),
    server = hoodiecrow({
        plugins: ["ID", "STARTTLS" /*, "LOGINDISABLED"*/ , "SASL-IR", "AUTH-PLAIN", "ENABLE", "UNSELECT"],
        id: {
            name: "hoodiecrow",
            version: "0.1"
        },

        storage: {
            "INBOX": {
                messages: [{
                    "file": "/home/anatoly/projects/hoodiecrow/complete.js"
                }]
            }
        },
        debug: true
    });

const PORT = 8143;
const localhost = '127.0.0.1';

server.listen(PORT, localhost, function() {
    console.log("Hoodiecrow listening on port %s", PORT)
});
