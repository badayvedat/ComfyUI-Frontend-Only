# Copied (and simplified) from: https://github.com/comfyanonymous/ComfyUI/blob/c61eadf69a3ba4033dcf22e2e190fd54f779fc5b/server.py

import asyncio
import glob
import json
import os
import struct
import sys
import traceback
import urllib
import uuid
from io import BytesIO

from PIL import Image, ImageOps
from PIL.PngImagePlugin import PngInfo

import folder_paths

try:
    import aiohttp
    from aiohttp import web
except ImportError:
    print("Module 'aiohttp' not installed. Please install it via:")
    print("pip install aiohttp")
    print("or")
    print("pip install -r requirements.txt")
    sys.exit()

import mimetypes

import nodes
from app.user_manager import UserManager


class BinaryEventTypes:
    PREVIEW_IMAGE = 1
    UNENCODED_PREVIEW_IMAGE = 2


async def send_socket_catch_exception(function, message):
    try:
        await function(message)
    except (
        aiohttp.ClientError,
        aiohttp.ClientPayloadError,
        ConnectionResetError,
    ) as err:
        print("send error:", err)


@web.middleware
async def cache_control(request: web.Request, handler):
    response: web.Response = await handler(request)
    if request.path.endswith(".js") or request.path.endswith(".css"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


def create_cors_middleware(allowed_origin: str):
    @web.middleware
    async def cors_middleware(request: web.Request, handler):
        if request.method == "OPTIONS":
            # Pre-flight request. Reply successfully:
            response = web.Response()
        else:
            response = await handler(request)

        response.headers["Access-Control-Allow-Origin"] = allowed_origin
        response.headers[
            "Access-Control-Allow-Methods"
        ] = "POST, GET, DELETE, PUT, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Credentials"] = "true"
        return response

    return cors_middleware


class PromptServer:
    def __init__(self, loop):
        PromptServer.instance = self

        mimetypes.init()
        mimetypes.types_map[".js"] = "application/javascript; charset=utf-8"

        self.user_manager = UserManager()
        self.supports = ["custom_nodes_from_web"]
        self.prompt_queue = None
        self.loop = loop
        self.messages = asyncio.Queue()
        self.number = 0

        middlewares = [cache_control]
        # middlewares.append(create_cors_middleware(args.enable_cors_header))

        max_upload_size_in_mb = 100
        max_upload_size = round(max_upload_size_in_mb * 1024 * 1024)
        self.app = web.Application(
            client_max_size=max_upload_size, middlewares=middlewares
        )
        self.sockets = dict()
        self.web_root = os.path.join(os.path.dirname(os.path.realpath(__file__)), "web")
        routes = web.RouteTableDef()
        self.routes = routes
        self.last_node_id = None
        self.client_id = None

        self.on_prompt_handlers = []

        @routes.get("/ws")
        async def websocket_handler(request):
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            sid = request.rel_url.query.get("clientId", "")
            if sid:
                # Reusing existing session, remove old
                self.sockets.pop(sid, None)
            else:
                sid = uuid.uuid4().hex

            self.sockets[sid] = ws

            try:
                # Send initial state to the new client
                await self.send(
                    "status", {"status": self.get_queue_info(), "sid": sid}, sid
                )
                # On reconnect if we are the currently executing client send the current node
                if self.client_id == sid and self.last_node_id is not None:
                    await self.send("executing", {"node": self.last_node_id}, sid)

                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.ERROR:
                        print("ws connection closed with exception %s" % ws.exception())
            finally:
                self.sockets.pop(sid, None)
            return ws

        @routes.get("/")
        async def get_root(request):
            return web.FileResponse(os.path.join(self.web_root, "index.html"))

        @routes.get("/embeddings")
        def get_embeddings(self):
            embeddings = folder_paths.get_filename_list("embeddings")
            return web.json_response(
                list(map(lambda a: os.path.splitext(a)[0], embeddings))
            )

        @routes.get("/extensions")
        async def get_extensions(request):
            files = glob.glob(
                os.path.join(glob.escape(self.web_root), "extensions/**/*.js"),
                recursive=True,
            )

            extensions = list(
                map(
                    lambda f: "/"
                    + os.path.relpath(f, self.web_root).replace("\\", "/"),
                    files,
                )
            )

            for name, dir in nodes.EXTENSION_WEB_DIRS.items():
                files = glob.glob(
                    os.path.join(glob.escape(dir), "**/*.js"), recursive=True
                )
                extensions.extend(
                    list(
                        map(
                            lambda f: "/extensions/"
                            + urllib.parse.quote(name)
                            + "/"
                            + os.path.relpath(f, dir).replace("\\", "/"),
                            files,
                        )
                    )
                )

            return web.json_response(extensions)

        def get_dir_by_type(dir_type):
            if dir_type is None:
                dir_type = "input"

            if dir_type == "input":
                type_dir = folder_paths.get_input_directory()
            elif dir_type == "temp":
                type_dir = folder_paths.get_temp_directory()
            elif dir_type == "output":
                type_dir = folder_paths.get_output_directory()

            return type_dir, dir_type

        def image_upload(post, image_save_function=None):
            image = post.get("image")
            overwrite = post.get("overwrite")

            image_upload_type = post.get("type")
            upload_dir, image_upload_type = get_dir_by_type(image_upload_type)

            if image and image.file:
                filename = image.filename
                if not filename:
                    return web.Response(status=400)

                subfolder = post.get("subfolder", "")
                full_output_folder = os.path.join(
                    upload_dir, os.path.normpath(subfolder)
                )
                filepath = os.path.abspath(os.path.join(full_output_folder, filename))

                if os.path.commonpath((upload_dir, filepath)) != upload_dir:
                    return web.Response(status=400)

                if not os.path.exists(full_output_folder):
                    os.makedirs(full_output_folder)

                split = os.path.splitext(filename)

                if overwrite is not None and (overwrite == "true" or overwrite == "1"):
                    pass
                else:
                    i = 1
                    while os.path.exists(filepath):
                        filename = f"{split[0]} ({i}){split[1]}"
                        filepath = os.path.join(full_output_folder, filename)
                        i += 1

                if image_save_function is not None:
                    image_save_function(image, post, filepath)
                else:
                    with open(filepath, "wb") as f:
                        f.write(image.file.read())

                return web.json_response(
                    {
                        "name": filename,
                        "subfolder": subfolder,
                        "type": image_upload_type,
                    }
                )
            else:
                return web.Response(status=400)

        @routes.post("/upload/image")
        async def upload_image(request):
            post = await request.post()
            return image_upload(post)

        @routes.post("/upload/mask")
        async def upload_mask(request):
            post = await request.post()

            def image_save_function(image, post, filepath):
                original_ref = json.loads(post.get("original_ref"))
                filename, output_dir = folder_paths.annotated_filepath(
                    original_ref["filename"]
                )

                # validation for security: prevent accessing arbitrary path
                if filename[0] == "/" or ".." in filename:
                    return web.Response(status=400)

                if output_dir is None:
                    type = original_ref.get("type", "output")
                    output_dir = folder_paths.get_directory_by_type(type)

                if output_dir is None:
                    return web.Response(status=400)

                if original_ref.get("subfolder", "") != "":
                    full_output_dir = os.path.join(
                        output_dir, original_ref["subfolder"]
                    )
                    if (
                        os.path.commonpath(
                            (os.path.abspath(full_output_dir), output_dir)
                        )
                        != output_dir
                    ):
                        return web.Response(status=403)
                    output_dir = full_output_dir

                file = os.path.join(output_dir, filename)

                if os.path.isfile(file):
                    with Image.open(file) as original_pil:
                        metadata = PngInfo()
                        if hasattr(original_pil, "text"):
                            for key in original_pil.text:
                                metadata.add_text(key, original_pil.text[key])
                        original_pil = original_pil.convert("RGBA")
                        mask_pil = Image.open(image.file).convert("RGBA")

                        # alpha copy
                        new_alpha = mask_pil.getchannel("A")
                        original_pil.putalpha(new_alpha)
                        original_pil.save(filepath, compress_level=4, pnginfo=metadata)

            return image_upload(post, image_save_function)

        @routes.get("/view")
        async def view_image(request):
            if "url" in request.rel_url.query:
                remote_url = request.rel_url.query["url"]

                # Ensure the remote URL is a valid and safe URL
                if remote_url.startswith("https://"):
                    # Redirect the client to the remote URL
                    return web.HTTPFound(remote_url)
                else:
                    return web.Response(status=400, text="Invalid URL format.")

            if "filename" in request.rel_url.query:
                filename = request.rel_url.query["filename"]
                filename, output_dir = folder_paths.annotated_filepath(filename)

                # validation for security: prevent accessing arbitrary path
                if filename[0] == "/" or ".." in filename:
                    return web.Response(status=400)

                if output_dir is None:
                    type = request.rel_url.query.get("type", "output")
                    output_dir = folder_paths.get_directory_by_type(type)

                if output_dir is None:
                    return web.Response(status=400)

                if "subfolder" in request.rel_url.query:
                    full_output_dir = os.path.join(
                        output_dir, request.rel_url.query["subfolder"]
                    )
                    if (
                        os.path.commonpath(
                            (os.path.abspath(full_output_dir), output_dir)
                        )
                        != output_dir
                    ):
                        return web.Response(status=403)
                    output_dir = full_output_dir

                filename = os.path.basename(filename)
                file = os.path.join(output_dir, filename)

                if os.path.isfile(file):
                    if "preview" in request.rel_url.query:
                        with Image.open(file) as img:
                            preview_info = request.rel_url.query["preview"].split(";")
                            image_format = preview_info[0]
                            if image_format not in [
                                "webp",
                                "jpeg",
                            ] or "a" in request.rel_url.query.get("channel", ""):
                                image_format = "webp"

                            quality = 90
                            if preview_info[-1].isdigit():
                                quality = int(preview_info[-1])

                            buffer = BytesIO()
                            if (
                                image_format in ["jpeg"]
                                or request.rel_url.query.get("channel", "") == "rgb"
                            ):
                                img = img.convert("RGB")
                            img.save(buffer, format=image_format, quality=quality)
                            buffer.seek(0)

                            return web.Response(
                                body=buffer.read(),
                                content_type=f"image/{image_format}",
                                headers={
                                    "Content-Disposition": f'filename="{filename}"'
                                },
                            )

                    if "channel" not in request.rel_url.query:
                        channel = "rgba"
                    else:
                        channel = request.rel_url.query["channel"]

                    if channel == "rgb":
                        with Image.open(file) as img:
                            if img.mode == "RGBA":
                                r, g, b, a = img.split()
                                new_img = Image.merge("RGB", (r, g, b))
                            else:
                                new_img = img.convert("RGB")

                            buffer = BytesIO()
                            new_img.save(buffer, format="PNG")
                            buffer.seek(0)

                            return web.Response(
                                body=buffer.read(),
                                content_type="image/png",
                                headers={
                                    "Content-Disposition": f'filename="{filename}"'
                                },
                            )

                    elif channel == "a":
                        with Image.open(file) as img:
                            if img.mode == "RGBA":
                                _, _, _, a = img.split()
                            else:
                                a = Image.new("L", img.size, 255)

                            # alpha img
                            alpha_img = Image.new("RGBA", img.size)
                            alpha_img.putalpha(a)
                            alpha_buffer = BytesIO()
                            alpha_img.save(alpha_buffer, format="PNG")
                            alpha_buffer.seek(0)

                            return web.Response(
                                body=alpha_buffer.read(),
                                content_type="image/png",
                                headers={
                                    "Content-Disposition": f'filename="{filename}"'
                                },
                            )
                    else:
                        return web.FileResponse(
                            file,
                            headers={"Content-Disposition": f'filename="{filename}"'},
                        )

            return web.Response(status=404)

        @routes.get("/prompt")
        async def get_prompt(request):
            return web.json_response(self.get_queue_info())

        def node_info(node_class):
            return nodes.NODE_CLASS_MAPPINGS[node_class]

        @routes.get("/object_info")
        async def get_object_info(request):
            return web.json_response(nodes.NODE_CLASS_MAPPINGS)

        @routes.get("/object_info/{node_class}")
        async def get_object_info_node(request):
            node_class = request.match_info.get("node_class", None)
            out = {}
            if (node_class is not None) and (node_class in nodes.NODE_CLASS_MAPPINGS):
                out[node_class] = node_info(node_class)
            return web.json_response(out)

        @routes.get("/history")
        async def get_history(request):
            max_items = request.rel_url.query.get("max_items", None)
            if max_items is not None:
                max_items = int(max_items)
            return web.json_response(self.prompt_queue.get_history(max_items=max_items))

        @routes.get("/history/{prompt_id}")
        async def get_history(request):
            prompt_id = request.match_info.get("prompt_id", None)
            return web.json_response(self.prompt_queue.get_history(prompt_id=prompt_id))

        @routes.get("/queue")
        async def get_queue(request):
            queue_info = {}
            current_queue = self.prompt_queue.get_current_queue()
            queue_info["queue_running"] = current_queue[0]
            queue_info["queue_pending"] = current_queue[1]
            return web.json_response(queue_info)

    def add_routes(self):
        self.user_manager.add_routes(self.routes)
        self.app.add_routes(self.routes)

        for name, dir in nodes.EXTENSION_WEB_DIRS.items():
            self.app.add_routes(
                [
                    web.static("/extensions/" + urllib.parse.quote(name), dir),
                ]
            )

        self.app.add_routes(
            [
                web.static("/", self.web_root),
            ]
        )

    def get_queue_info(self):
        prompt_info = {}
        exec_info = {}
        exec_info["queue_remaining"] = 0
        prompt_info["exec_info"] = exec_info
        return prompt_info

    async def send(self, event, data, sid=None):
        if event == BinaryEventTypes.UNENCODED_PREVIEW_IMAGE:
            await self.send_image(data, sid=sid)
        elif isinstance(data, (bytes, bytearray)):
            await self.send_bytes(event, data, sid)
        else:
            await self.send_json(event, data, sid)

    def encode_bytes(self, event, data):
        if not isinstance(event, int):
            raise RuntimeError(f"Binary event types must be integers, got {event}")

        packed = struct.pack(">I", event)
        message = bytearray(packed)
        message.extend(data)
        return message

    async def send_image(self, image_data, sid=None):
        image_type = image_data[0]
        image = image_data[1]
        max_size = image_data[2]
        if max_size is not None:
            if hasattr(Image, "Resampling"):
                resampling = Image.Resampling.BILINEAR
            else:
                resampling = Image.ANTIALIAS

            image = ImageOps.contain(image, (max_size, max_size), resampling)
        type_num = 1
        if image_type == "JPEG":
            type_num = 1
        elif image_type == "PNG":
            type_num = 2

        bytesIO = BytesIO()
        header = struct.pack(">I", type_num)
        bytesIO.write(header)
        image.save(bytesIO, format=image_type, quality=95, compress_level=1)
        preview_bytes = bytesIO.getvalue()
        await self.send_bytes(BinaryEventTypes.PREVIEW_IMAGE, preview_bytes, sid=sid)

    async def send_bytes(self, event, data, sid=None):
        message = self.encode_bytes(event, data)

        if sid is None:
            sockets = list(self.sockets.values())
            for ws in sockets:
                await send_socket_catch_exception(ws.send_bytes, message)
        elif sid in self.sockets:
            await send_socket_catch_exception(self.sockets[sid].send_bytes, message)

    async def send_json(self, event, data, sid=None):
        message = {"type": event, "data": data}

        if sid is None:
            sockets = list(self.sockets.values())
            for ws in sockets:
                await send_socket_catch_exception(ws.send_json, message)
        elif sid in self.sockets:
            await send_socket_catch_exception(self.sockets[sid].send_json, message)

    def send_sync(self, event, data, sid=None):
        self.loop.call_soon_threadsafe(self.messages.put_nowait, (event, data, sid))

    def queue_updated(self):
        self.send_sync("status", {"status": self.get_queue_info()})

    async def publish_loop(self):
        while True:
            msg = await self.messages.get()
            await self.send(*msg)

    async def start(self, address, port, verbose=True, call_on_start=None):
        runner = web.AppRunner(self.app, access_log=None)
        await runner.setup()
        site = web.TCPSite(runner, address, port)
        await site.start()

        if verbose:
            print("Starting server\n")
            print("To see the GUI go to: http://{}:{}".format(address, port))
        if call_on_start is not None:
            call_on_start(address, port)

    def add_on_prompt_handler(self, handler):
        self.on_prompt_handlers.append(handler)

    def trigger_on_prompt(self, json_data):
        for handler in self.on_prompt_handlers:
            try:
                json_data = handler(json_data)
            except Exception as e:
                print(
                    f"[ERROR] An error occurred during the on_prompt_handler processing"
                )
                traceback.print_exc()

        return json_data
