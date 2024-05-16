# Copied (and simplified) from: https://github.com/comfyanonymous/ComfyUI/blob/c61eadf69a3ba4033dcf22e2e190fd54f779fc5b/main.py

import asyncio
import os

import folder_paths
from nodes import init_custom_nodes
import server
from comfy.cli_args import args


async def run(server, address="", port=8188, verbose=True, call_on_start=None):
    await asyncio.gather(
        server.start(address, port, verbose, call_on_start), server.publish_loop()
    )


if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    server = server.PromptServer(loop)

    if args.input_directory:
        input_dir = os.path.abspath(args.input_directory)
        print(f"Setting input directory to: {input_dir}")
        folder_paths.set_input_directory(input_dir)

    init_custom_nodes()
    server.add_routes()

    call_on_start = None
    if args.auto_launch:

        def startup_server(address, port):
            import webbrowser

            if os.name == "nt" and address == "0.0.0.0":
                address = "127.0.0.1"
            webbrowser.open(f"http://{address}:{port}")

        call_on_start = startup_server

    try:
        loop.run_until_complete(
            run(
                server,
                address=args.listen,
                port=args.port,
                verbose=not args.dont_print_server,
                call_on_start=call_on_start,
            )
        )
    except KeyboardInterrupt:
        print("\nStopped server")
