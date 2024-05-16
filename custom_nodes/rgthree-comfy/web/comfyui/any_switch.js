import { app } from "../../scripts/app.js";
import { IoDirection, addConnectionLayoutSupport, applyMixins, followConnectionUntilType, } from "./utils.js";
import { RgthreeBaseNode } from "./base_node.js";
let hasShownAlertForUpdatingInt = false;
class AnySwitchforMixin extends RgthreeBaseNode {
    constructor() {
        super(...arguments);
        this.scheduleStabilizePromise = null;
        this.nodeType = null;
    }
    onConnectionsChange(type, slotIndex, isConnected, linkInfo, ioSlot) {
        var _a;
        (_a = super.onConnectionsChange) === null || _a === void 0 ? void 0 : _a.call(this, type, slotIndex, isConnected, linkInfo, ioSlot);
        this.scheduleStabilize();
    }
    onConnectionsChainChange() {
        this.scheduleStabilize();
    }
    scheduleStabilize(ms = 64) {
        if (!this.scheduleStabilizePromise) {
            this.scheduleStabilizePromise = new Promise((resolve) => {
                setTimeout(() => {
                    this.scheduleStabilizePromise = null;
                    this.stabilize();
                    resolve();
                }, ms);
            });
        }
        return this.scheduleStabilizePromise;
    }
    stabilize() {
        let connectedType = followConnectionUntilType(this, IoDirection.INPUT, undefined, true);
        if (!connectedType) {
            connectedType = followConnectionUntilType(this, IoDirection.OUTPUT, undefined, true);
        }
        this.nodeType = (connectedType === null || connectedType === void 0 ? void 0 : connectedType.type) || "*";
        for (const input of this.inputs) {
            input.type = this.nodeType;
        }
        for (const output of this.outputs) {
            output.type = this.nodeType;
            output.label =
                output.type === 'RGTHREE_CONTEXT' ? 'CONTEXT' :
                    Array.isArray(this.nodeType) || this.nodeType.includes(",")
                        ? (connectedType === null || connectedType === void 0 ? void 0 : connectedType.label) || String(this.nodeType)
                        : String(this.nodeType);
        }
    }
    static setUp(nodeType) {
        AnySwitchforMixin.title = nodeType.title;
        AnySwitchforMixin.type = nodeType.type || nodeType.title;
        AnySwitchforMixin.comfyClass = nodeType.comfyClass;
        setTimeout(() => {
            AnySwitchforMixin.category = nodeType.category;
        });
        applyMixins(nodeType, [RgthreeBaseNode, AnySwitchforMixin]);
        addConnectionLayoutSupport(nodeType, app, [["Left", "Right"], ["Right", "Left"]]);
    }
}
AnySwitchforMixin.comfyClass = "";
app.registerExtension({
    name: "rgthree.AnySwitch",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "Any Switch (rgthree)") {
            AnySwitchforMixin.setUp(nodeType);
        }
    },
});
