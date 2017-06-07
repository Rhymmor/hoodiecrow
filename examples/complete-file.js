var hoodiecrow = require("../app/server"),
    server = hoodiecrow({
        plugins: ["ID", "STARTTLS" /*, "LOGINDISABLED"*/ , "SASL-IR", "AUTH-PLAIN", "ENABLE", "UNSELECT"],
        id: {
            name: "hoodiecrow",
            version: "0.1"
        },

        storage: {
            "INBOX": {
                messages: [{
                    "file": "/Users/anatoly.belonog/Documents/projects/hoodiecrow/examples/complete.js"
                }, {
                    raw: 'asdasdasd21312ekdao;dkaspod \n\n 21p3ok123po12 \n'
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
