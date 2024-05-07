import importlib.util
import json
import os
import sys
import traceback


# Copied from: https://github.com/comfyanonymous/ComfyUI/blob/c61eadf69a3ba4033dcf22e2e190fd54f779fc5b/nodes.py#L1850-L1886
def load_custom_node(module_path, ignore=set()):
    module_name = os.path.basename(module_path)
    if os.path.isfile(module_path):
        sp = os.path.splitext(module_path)
        module_name = sp[0]
    try:
        if os.path.isfile(module_path):
            module_spec = importlib.util.spec_from_file_location(
                module_name, module_path
            )
            module_dir = os.path.split(module_path)[0]
        else:
            module_spec = importlib.util.spec_from_file_location(
                module_name, os.path.join(module_path, "__init__.py")
            )
            module_dir = module_path

        module = importlib.util.module_from_spec(module_spec)
        sys.modules[module_name] = module
        module_spec.loader.exec_module(module)

        if (
            hasattr(module, "WEB_DIRECTORY")
            and getattr(module, "WEB_DIRECTORY") is not None
        ):
            web_dir = os.path.abspath(
                os.path.join(module_dir, getattr(module, "WEB_DIRECTORY"))
            )
            if os.path.isdir(web_dir):
                EXTENSION_WEB_DIRS[module_name] = web_dir

        if (
            hasattr(module, "NODE_CLASS_MAPPINGS")
            and getattr(module, "NODE_CLASS_MAPPINGS") is not None
        ):
            for name in module.NODE_CLASS_MAPPINGS:
                if name not in ignore:
                    NODE_CLASS_MAPPINGS[name] = module.NODE_CLASS_MAPPINGS[name]
            if (
                hasattr(module, "NODE_DISPLAY_NAME_MAPPINGS")
                and getattr(module, "NODE_DISPLAY_NAME_MAPPINGS") is not None
            ):
                NODE_DISPLAY_NAME_MAPPINGS.update(module.NODE_DISPLAY_NAME_MAPPINGS)
            return True
        else:
            print(
                f"Skip {module_path} module for custom nodes due to the lack of NODE_CLASS_MAPPINGS."
            )
            return False
    except Exception as e:
        print(traceback.format_exc())
        print(f"Cannot import {module_path} module for custom nodes:", e)
        return False


def load_json_file(file_path: str) -> dict:
    with open(file_path, "r") as fp:
        return json.load(fp)


EXTENSION_WEB_DIRS = load_json_file("extension_web_dirs.json")

NODE_CLASS_MAPPINGS = load_json_file("node_class_mappings.json")

NODE_DISPLAY_NAME_MAPPINGS = load_json_file("node_display_name_mappings.json")
