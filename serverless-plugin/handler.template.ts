import { spawn } from 'child_process';
import * as net from 'net';

type Options = {
    executable: string;
    arguments: string[];
};

function wrapper(options: Options): (event: unknown) => Promise<void> {
    const executable = options.executable;
    const execArguments = options.arguments;
    return async (event: unknown): Promise<void> => {
        process.env.PATH = `${process.env.PATH}:${process.env.LAMBDA_TASK_ROOT}`;

        const server = net.createServer();

        const connection = new Promise<net.Socket>(resolve => server.on('connection', resolve));

        const address: net.AddressInfo = await new Promise<net.AddressInfo>(
            resolve =>
                server.listen({port: 0, host: "127.0.0.1"}, () => resolve(server.address() as net.AddressInfo)));
        const port = address.port;

        process.env.SERVERLESS_HASKELL_COMMUNICATION_PORT = `${port}`;

        const main = spawn('./' + executable, execArguments, {
            stdio: ['pipe', process.stdout, process.stderr],
        });
        const stdin = main.stdin;

        // Send the event to the process
        stdin.end(JSON.stringify(event) + '\n', 'utf8');

        const socket = await connection;

        // Close the listening socket, no more connections needed
        server.close();

        // Keep track of the output result
        let output = '';
        socket.on('data', chunk => output += chunk);

        // Wait for the process to exit or close the socket, whichever happens
        // first
        return await new Promise((resolve, reject) => {
            function resolveWithOutput(): void {
                try {
                    const result = JSON.parse(output);
                    resolve(result);
                } catch (err) {
                    reject('child process output bad JSON: ' + output);
                }
            }

            socket.on('end', resolveWithOutput);

            main.on('exit', code => {
                if (code === 0) {
                    // If the "main exit" was received before "socket closed",
                    // wait for a while before resolving, since the data sent
                    // over the socket might not have arrived yet either.
                    setTimeout(resolveWithOutput, 100);
                }
                else {
                    reject('child process exited with code ' + code);
                }
            });

            main.on('error', err => reject('child process exited with error: ' + err));
        });
    };
}

exports['__wrapper'] = wrapper;

// exports such as below will be added here by the plugin
// exports['EXECUTABLENAME'] = wrapper({
//   executable: 'EXECUTABLENAME',
//   arguments: ['--arg1', '--arg2'],
// });
