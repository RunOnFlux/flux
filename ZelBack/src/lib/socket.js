const socketio = require('socket.io');
const Docker = require('dockerode');
const docker = new Docker();

let io;

function initIO(httpServer, path = '/console') {

    io = socketio(httpServer, { path });
    io.on('connection', (socket) => {
        socket.on('exec', (id, w, h) => {
            const container = docker.getContainer(id);
            let cmd = {
                'AttachStdout': true,
                'AttachStderr': true,
                'AttachStdin': true,
                'Tty': true,
                Cmd: ['/bin/bash'],
            };
            socket.on('resize', (data) => {
                container.resize({h: data.rows, w: data.cols}, () => {
                });
            });
            container.exec(cmd, (err, exec) => {
                let options = {
                    'Tty': true,
                    stream: true,
                    stdin: true,
                    stdout: true,
                    stderr: true,
                    hijack: true,
                };

                container.wait((err, data) => {
                    socket.emit('end', 'ended');
                });

                if (err) {
                    return;
                }

                exec.start(options, (err, stream) => {
                    stream.on('data', (chunk) => {
                        socket.emit('show', chunk.toString());
                    });

                    socket.on('cmd', (data) => {
                        if (typeof data !== 'object')
                            stream.write(data);
                    });
                });
            });
        });

        socket.on('end', () => {
            array = [];
            streams.map((stream) => {
                stream.destroy();
            });
            console.log('--------end---------');
        });
    });
}

module.exports = {
    initIO,
};