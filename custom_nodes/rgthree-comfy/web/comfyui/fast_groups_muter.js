import { app } from "../../scripts/app.js";
import { RgthreeBaseNode } from "./base_node.js";
import { NodeTypesString } from "./constants.js";
import { fitString } from "./utils_canvas.js";
const PROPERTY_SORT = "sort";
const PROPERTY_SORT_CUSTOM_ALPHA = "customSortAlphabet";
const PROPERTY_MATCH_COLORS = "matchColors";
const PROPERTY_MATCH_TITLE = "matchTitle";
const PROPERTY_SHOW_NAV = "showNav";
const PROPERTY_RESTRICTION = "toggleRestriction";
class FastGroupsService {
    constructor() {
        this.msThreshold = 400;
        this.msLastUnsorted = 0;
        this.msLastAlpha = 0;
        this.msLastPosition = 0;
        this.groupsUnsorted = [];
        this.groupsSortedAlpha = [];
        this.groupsSortedPosition = [];
        this.fastGroupNodes = [];
        this.runScheduledForMs = null;
        this.runScheduleTimeout = null;
        this.runScheduleAnimation = null;
        this.cachedNodeBoundings = null;
    }
    addFastGroupNode(node) {
        this.fastGroupNodes.push(node);
        this.scheduleRun(8);
    }
    removeFastGroupNode(node) {
        var _a;
        const index = this.fastGroupNodes.indexOf(node);
        if (index > -1) {
            this.fastGroupNodes.splice(index, 1);
        }
        if (!((_a = this.fastGroupNodes) === null || _a === void 0 ? void 0 : _a.length)) {
            this.clearScheduledRun();
            this.groupsUnsorted = [];
            this.groupsSortedAlpha = [];
            this.groupsSortedPosition = [];
        }
    }
    run() {
        if (!this.runScheduledForMs) {
            return;
        }
        for (const node of this.fastGroupNodes) {
            node.refreshWidgets();
        }
        this.clearScheduledRun();
        this.scheduleRun();
    }
    scheduleRun(ms = 500) {
        if (this.runScheduledForMs && ms < this.runScheduledForMs) {
            this.clearScheduledRun();
        }
        if (!this.runScheduledForMs && this.fastGroupNodes.length) {
            this.runScheduledForMs = ms;
            this.runScheduleTimeout = setTimeout(() => {
                this.runScheduleAnimation = requestAnimationFrame(() => this.run());
            }, ms);
        }
    }
    clearScheduledRun() {
        this.runScheduleTimeout && clearTimeout(this.runScheduleTimeout);
        this.runScheduleAnimation && cancelAnimationFrame(this.runScheduleAnimation);
        this.runScheduleTimeout = null;
        this.runScheduleAnimation = null;
        this.runScheduledForMs = null;
    }
    getBoundingsForAllNodes() {
        if (!this.cachedNodeBoundings) {
            this.cachedNodeBoundings = {};
            for (const node of app.graph._nodes) {
                this.cachedNodeBoundings[node.id] = node.getBounding();
            }
            setTimeout(() => {
                this.cachedNodeBoundings = null;
            }, 50);
        }
        return this.cachedNodeBoundings;
    }
    recomputeInsideNodesForGroup(group) {
        const cachedBoundings = this.getBoundingsForAllNodes();
        const nodes = group.graph._nodes;
        group._nodes.length = 0;
        for (const node of nodes) {
            const node_bounding = cachedBoundings[node.id];
            if (!node_bounding || !LiteGraph.overlapBounding(group._bounding, node_bounding)) {
                continue;
            }
            group._nodes.push(node);
        }
    }
    getGroupsUnsorted(now) {
        const graph = app.graph;
        if (!this.groupsUnsorted.length || now - this.msLastUnsorted > this.msThreshold) {
            this.groupsUnsorted = [...graph._groups];
            for (const group of this.groupsUnsorted) {
                this.recomputeInsideNodesForGroup(group);
                group._rgthreeHasAnyActiveNode = group._nodes.some((n) => n.mode === LiteGraph.ALWAYS);
            }
            this.msLastUnsorted = now;
        }
        return this.groupsUnsorted;
    }
    getGroupsAlpha(now) {
        const graph = app.graph;
        if (!this.groupsSortedAlpha.length || now - this.msLastAlpha > this.msThreshold) {
            this.groupsSortedAlpha = [...this.getGroupsUnsorted(now)].sort((a, b) => {
                return a.title.localeCompare(b.title);
            });
            this.msLastAlpha = now;
        }
        return this.groupsSortedAlpha;
    }
    getGroupsPosition(now) {
        const graph = app.graph;
        if (!this.groupsSortedPosition.length || now - this.msLastPosition > this.msThreshold) {
            this.groupsSortedPosition = [...this.getGroupsUnsorted(now)].sort((a, b) => {
                const aY = Math.floor(a._pos[1] / 30);
                const bY = Math.floor(b._pos[1] / 30);
                if (aY == bY) {
                    const aX = Math.floor(a._pos[0] / 30);
                    const bX = Math.floor(b._pos[0] / 30);
                    return aX - bX;
                }
                return aY - bY;
            });
            this.msLastPosition = now;
        }
        return this.groupsSortedPosition;
    }
    getGroups(sort) {
        const now = +new Date();
        if (sort === "alphanumeric") {
            return this.getGroupsAlpha(now);
        }
        if (sort === "position") {
            return this.getGroupsPosition(now);
        }
        return this.getGroupsUnsorted(now);
    }
}
const SERVICE = new FastGroupsService();
export class FastGroupsMuter extends RgthreeBaseNode {
    constructor(title = FastGroupsMuter.title) {
        super(title);
        this.isVirtualNode = true;
        this.modeOn = LiteGraph.ALWAYS;
        this.modeOff = LiteGraph.NEVER;
        this.debouncerTempWidth = 0;
        this.tempSize = null;
        this.serialize_widgets = false;
        this.helpActions = "must and unmute";
        this.properties[PROPERTY_MATCH_COLORS] = "";
        this.properties[PROPERTY_MATCH_TITLE] = "";
        this.properties[PROPERTY_SHOW_NAV] = true;
        this.properties[PROPERTY_SORT] = "position";
        this.properties[PROPERTY_SORT_CUSTOM_ALPHA] = "";
        this.properties[PROPERTY_RESTRICTION] = "default";
        this.addOutput("OPT_CONNECTION", "*");
    }
    onAdded(graph) {
        SERVICE.addFastGroupNode(this);
    }
    onRemoved() {
        SERVICE.removeFastGroupNode(this);
    }
    refreshWidgets() {
        var _a, _b, _c, _d, _e, _f, _g;
        const canvas = app.canvas;
        let sort = ((_a = this.properties) === null || _a === void 0 ? void 0 : _a[PROPERTY_SORT]) || "position";
        let customAlphabet = null;
        if (sort === "custom alphabet") {
            const customAlphaStr = (_c = (_b = this.properties) === null || _b === void 0 ? void 0 : _b[PROPERTY_SORT_CUSTOM_ALPHA]) === null || _c === void 0 ? void 0 : _c.replace(/\n/g, "");
            if (customAlphaStr && customAlphaStr.trim()) {
                customAlphabet = customAlphaStr.includes(",")
                    ? customAlphaStr.toLocaleLowerCase().split(",")
                    : customAlphaStr.toLocaleLowerCase().trim().split("");
            }
            if (!(customAlphabet === null || customAlphabet === void 0 ? void 0 : customAlphabet.length)) {
                sort = "alphanumeric";
                customAlphabet = null;
            }
        }
        const groups = [...SERVICE.getGroups(sort)];
        if (customAlphabet === null || customAlphabet === void 0 ? void 0 : customAlphabet.length) {
            groups.sort((a, b) => {
                let aIndex = -1;
                let bIndex = -1;
                for (const [index, alpha] of customAlphabet.entries()) {
                    aIndex =
                        aIndex < 0 ? (a.title.toLocaleLowerCase().startsWith(alpha) ? index : -1) : aIndex;
                    bIndex =
                        bIndex < 0 ? (b.title.toLocaleLowerCase().startsWith(alpha) ? index : -1) : bIndex;
                    if (aIndex > -1 && bIndex > -1) {
                        break;
                    }
                }
                if (aIndex > -1 && bIndex > -1) {
                    const ret = aIndex - bIndex;
                    if (ret === 0) {
                        return a.title.localeCompare(b.title);
                    }
                    return ret;
                }
                else if (aIndex > -1) {
                    return -1;
                }
                else if (bIndex > -1) {
                    return 1;
                }
                return a.title.localeCompare(b.title);
            });
        }
        let filterColors = (((_e = (_d = this.properties) === null || _d === void 0 ? void 0 : _d[PROPERTY_MATCH_COLORS]) === null || _e === void 0 ? void 0 : _e.split(",")) || []).filter((c) => c.trim());
        if (filterColors.length) {
            filterColors = filterColors.map((color) => {
                color = color.trim().toLocaleLowerCase();
                if (LGraphCanvas.node_colors[color]) {
                    color = LGraphCanvas.node_colors[color].groupcolor;
                }
                color = color.replace("#", "").toLocaleLowerCase();
                if (color.length === 3) {
                    color = color.replace(/(.)(.)(.)/, "$1$1$2$2$3$3");
                }
                return `#${color}`;
            });
        }
        let index = 0;
        for (const group of groups) {
            if (filterColors.length) {
                let groupColor = group.color.replace("#", "").trim().toLocaleLowerCase();
                if (groupColor.length === 3) {
                    groupColor = groupColor.replace(/(.)(.)(.)/, "$1$1$2$2$3$3");
                }
                groupColor = `#${groupColor}`;
                if (!filterColors.includes(groupColor)) {
                    continue;
                }
            }
            if ((_g = (_f = this.properties) === null || _f === void 0 ? void 0 : _f[PROPERTY_MATCH_TITLE]) === null || _g === void 0 ? void 0 : _g.trim()) {
                try {
                    if (!new RegExp(this.properties[PROPERTY_MATCH_TITLE], "i").exec(group.title)) {
                        continue;
                    }
                }
                catch (e) {
                    console.error(e);
                    continue;
                }
            }
            this.widgets = this.widgets || [];
            const widgetName = `Enable ${group.title}`;
            let widget = this.widgets.find((w) => w.name === widgetName);
            if (!widget) {
                this.tempSize = [...this.size];
                widget = this.addCustomWidget({
                    name: "RGTHREE_TOGGLE_AND_NAV",
                    label: "",
                    value: false,
                    disabled: false,
                    options: { on: "yes", off: "no" },
                    draw: function (ctx, node, width, posY, height) {
                        var _a, _b;
                        const lowQuality = (((_a = canvas.ds) === null || _a === void 0 ? void 0 : _a.scale) || 1) <= 0.5;
                        let margin = 15;
                        let outline_color = LiteGraph.WIDGET_OUTLINE_COLOR;
                        let background_color = LiteGraph.WIDGET_BGCOLOR;
                        let text_color = LiteGraph.WIDGET_TEXT_COLOR;
                        let secondary_text_color = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR;
                        const showNav = ((_b = node.properties) === null || _b === void 0 ? void 0 : _b[PROPERTY_SHOW_NAV]) !== false;
                        ctx.strokeStyle = outline_color;
                        ctx.fillStyle = background_color;
                        ctx.beginPath();
                        ctx.roundRect(margin, posY, width - margin * 2, height, lowQuality ? [0] : [height * 0.5]);
                        ctx.fill();
                        if (!lowQuality) {
                            ctx.stroke();
                        }
                        let currentX = width - margin;
                        if (!lowQuality && showNav) {
                            currentX -= 7;
                            const midY = posY + height * 0.5;
                            ctx.fillStyle = ctx.strokeStyle = "#89A";
                            ctx.lineJoin = "round";
                            ctx.lineCap = "round";
                            const arrow = new Path2D(`M${currentX} ${midY} l -7 6 v -3 h -7 v -6 h 7 v -3 z`);
                            ctx.fill(arrow);
                            ctx.stroke(arrow);
                            currentX -= 14;
                            currentX -= 7;
                            ctx.strokeStyle = outline_color;
                            ctx.stroke(new Path2D(`M ${currentX} ${posY} v ${height}`));
                        }
                        else if (lowQuality && showNav) {
                            currentX -= 28;
                        }
                        currentX -= 7;
                        ctx.fillStyle = this.value ? "#89A" : "#333";
                        ctx.beginPath();
                        const toggleRadius = height * 0.36;
                        ctx.arc(currentX - toggleRadius, posY + height * 0.5, toggleRadius, 0, Math.PI * 2);
                        ctx.fill();
                        currentX -= toggleRadius * 2;
                        if (!lowQuality) {
                            currentX -= 4;
                            ctx.textAlign = "right";
                            ctx.fillStyle = this.value ? text_color : secondary_text_color;
                            const label = this.label || this.name;
                            const toggleLabelOn = this.options.on || "true";
                            const toggleLabelOff = this.options.off || "false";
                            ctx.fillText(this.value ? toggleLabelOn : toggleLabelOff, currentX, posY + height * 0.7);
                            currentX -= Math.max(ctx.measureText(toggleLabelOn).width, ctx.measureText(toggleLabelOff).width);
                            currentX -= 7;
                            ctx.textAlign = "left";
                            let maxLabelWidth = width - margin - 10 - (width - currentX);
                            if (label != null) {
                                ctx.fillText(fitString(ctx, label, maxLabelWidth), margin + 10, posY + height * 0.7);
                            }
                        }
                    },
                    serializeValue(serializedNode, widgetIndex) {
                        return this.value;
                    },
                    mouse(event, pos, node) {
                        var _a, _b, _c;
                        if (event.type == "pointerdown") {
                            if (((_a = node.properties) === null || _a === void 0 ? void 0 : _a[PROPERTY_SHOW_NAV]) !== false &&
                                pos[0] >= node.size[0] - 15 - 28 - 1) {
                                const canvas = app.canvas;
                                const lowQuality = (((_b = canvas.ds) === null || _b === void 0 ? void 0 : _b.scale) || 1) <= 0.5;
                                if (!lowQuality) {
                                    canvas.centerOnNode(group);
                                    const zoomCurrent = ((_c = canvas.ds) === null || _c === void 0 ? void 0 : _c.scale) || 1;
                                    const zoomX = canvas.canvas.width / group._size[0] - 0.02;
                                    const zoomY = canvas.canvas.height / group._size[1] - 0.02;
                                    canvas.setZoom(Math.min(zoomCurrent, zoomX, zoomY), [
                                        canvas.canvas.width / 2,
                                        canvas.canvas.height / 2,
                                    ]);
                                    canvas.setDirty(true, true);
                                }
                            }
                            else {
                                this.value = !this.value;
                                setTimeout(() => {
                                    var _a;
                                    (_a = this.callback) === null || _a === void 0 ? void 0 : _a.call(this, this.value, app.canvas, node, pos, event);
                                }, 20);
                            }
                        }
                        return true;
                    },
                });
                widget.doModeChange = (force, skipOtherNodeCheck) => {
                    var _a, _b, _c;
                    group.recomputeInsideNodes();
                    const hasAnyActiveNodes = group._nodes.some((n) => n.mode === LiteGraph.ALWAYS);
                    let newValue = force != null ? force : !hasAnyActiveNodes;
                    if (skipOtherNodeCheck !== true) {
                        if (newValue && ((_b = (_a = this.properties) === null || _a === void 0 ? void 0 : _a[PROPERTY_RESTRICTION]) === null || _b === void 0 ? void 0 : _b.includes(' one'))) {
                            for (const widget of this.widgets) {
                                widget.doModeChange(false, true);
                            }
                        }
                        else if (!newValue && ((_c = this.properties) === null || _c === void 0 ? void 0 : _c[PROPERTY_RESTRICTION]) === 'always one') {
                            newValue = this.widgets.every(w => !w.value || w === widget);
                        }
                    }
                    for (const node of group._nodes) {
                        node.mode = (newValue ? this.modeOn : this.modeOff);
                    }
                    group._rgthreeHasAnyActiveNode = newValue;
                    widget.value = newValue;
                    app.graph.setDirtyCanvas(true, false);
                };
                widget.callback = () => {
                    widget.doModeChange();
                };
                this.setSize(this.computeSize());
            }
            if (widget.name != widgetName) {
                widget.name = widgetName;
                this.setDirtyCanvas(true, false);
            }
            if (widget.value != group._rgthreeHasAnyActiveNode) {
                widget.value = group._rgthreeHasAnyActiveNode;
                this.setDirtyCanvas(true, false);
            }
            if (this.widgets[index] !== widget) {
                const oldIndex = this.widgets.findIndex((w) => w === widget);
                this.widgets.splice(index, 0, this.widgets.splice(oldIndex, 1)[0]);
                this.setDirtyCanvas(true, false);
            }
            index++;
        }
        while ((this.widgets || [])[index]) {
            this.removeWidget(index++);
        }
    }
    computeSize(out) {
        let size = super.computeSize(out);
        if (this.tempSize) {
            size[0] = Math.max(this.tempSize[0], size[0]);
            size[1] = Math.max(this.tempSize[1], size[1]);
            this.debouncerTempWidth && clearTimeout(this.debouncerTempWidth);
            this.debouncerTempWidth = setTimeout(() => {
                this.tempSize = null;
            }, 32);
        }
        setTimeout(() => {
            app.graph.setDirtyCanvas(true, true);
        }, 16);
        return size;
    }
    async handleAction(action) {
        var _a, _b, _c, _d, _e;
        if (action === "Mute all" || action === "Bypass all") {
            const alwaysOne = ((_a = this.properties) === null || _a === void 0 ? void 0 : _a[PROPERTY_RESTRICTION]) === "always one";
            for (const [index, widget] of this.widgets.entries()) {
                widget === null || widget === void 0 ? void 0 : widget.doModeChange(alwaysOne && !index ? true : false, true);
            }
        }
        else if (action === "Enable all") {
            const onlyOne = (_b = this.properties) === null || _b === void 0 ? void 0 : _b[PROPERTY_RESTRICTION].includes(" one");
            for (const [index, widget] of this.widgets.entries()) {
                widget === null || widget === void 0 ? void 0 : widget.doModeChange(onlyOne && index > 0 ? false : true, true);
            }
        }
        else if (action === "Toggle all") {
            const onlyOne = (_c = this.properties) === null || _c === void 0 ? void 0 : _c[PROPERTY_RESTRICTION].includes(" one");
            let foundOne = false;
            for (const [index, widget] of this.widgets.entries()) {
                let newValue = onlyOne && foundOne ? false : !widget.value;
                foundOne = foundOne || newValue;
                widget === null || widget === void 0 ? void 0 : widget.doModeChange(newValue, true);
            }
            if (!foundOne && ((_d = this.properties) === null || _d === void 0 ? void 0 : _d[PROPERTY_RESTRICTION]) === "always one") {
                (_e = this.widgets[this.widgets.length - 1]) === null || _e === void 0 ? void 0 : _e.doModeChange(true, true);
            }
        }
    }
    getHelp() {
        return `
      <p>The ${this.type.replace("(rgthree)", "")} is an input-less node that automatically collects all groups in your current
      workflow and allows you to quickly ${this.helpActions} all nodes within the group.</p>
      <ul>
        <li>
          <p>
            <strong>Properties.</strong> You can change the following properties (by right-clicking
            on the node, and select "Properties" or "Properties Panel" from the menu):
          </p>
          <ul>
            <li><p>
              <code>${PROPERTY_MATCH_COLORS}</code> - Only add groups that match the provided
              colors. Can be ComfyUI colors (red, pale_blue) or hex codes (#a4d399). Multiple can be
              added, comma delimited.
            </p></li>
            <li><p>
              <code>${PROPERTY_MATCH_TITLE}</code> - Filter the list of toggles by title match
              (string match, or regular expression).
            </p></li>
            <li><p>
              <code>${PROPERTY_SHOW_NAV}</code> - Add / remove a quick navigation arrow to take you
              to the group. <i>(default: true)</i>
              </p></li>
            <li><p>
              <code>${PROPERTY_SORT}</code> - Sort the toggles' order by "alphanumeric", graph
              "position", or "custom alphabet". <i>(default: "position")</i>
            </p></li>
            <li>
              <p>
                <code>${PROPERTY_SORT_CUSTOM_ALPHA}</code> - When the
                <code>${PROPERTY_SORT}</code> property is "custom alphabet" you can define the
                alphabet to use here, which will match the <i>beginning</i> of each group name and
                sort against it. If group titles do not match any custom alphabet entry, then they
                will be put after groups that do, ordered alphanumerically.
              </p>
              <p>
                This can be a list of single characters, like "zyxw..." or comma delimited strings
                for more control, like "sdxl,pro,sd,n,p".
              </p>
              <p>
                Note, when two group title match the same custom alphabet entry, the <i>normal
                alphanumeric alphabet</i> breaks the tie. For instance, a custom alphabet of
                "e,s,d" will order groups names like "SDXL, SEGS, Detailer" eventhough the custom
                alphabet has an "e" before "d" (where one may expect "SE" to be before "SD").
              </p>
              <p>
                To have "SEGS" appear before "SDXL" you can use longer strings. For instance, the
                custom alphabet value of "se,s,f" would work here.
              </p>
            </li>
            <li><p>
              <code>${PROPERTY_RESTRICTION}</code> - Optionally, attempt to restrict the number of
              widgets that can be enabled to a maximum of one, or always one.
              </p>
              <p><em><strong>Note:</strong> If using "max one" or "always one" then this is only
              enforced when clicking a toggle on this node; if nodes within groups are changed
              outside of the initial toggle click, then these restriction will not be enforced, and
              could result in a state where more than one toggle is enabled. This could also happen
              if nodes are overlapped with multiple groups.
            </p></li>

          </ul>
        </li>
      </ul>`;
    }
    static setUp(clazz) {
        LiteGraph.registerNodeType(clazz.type, clazz);
        clazz.category = clazz._category;
    }
}
FastGroupsMuter.type = NodeTypesString.FAST_GROUPS_MUTER;
FastGroupsMuter.title = NodeTypesString.FAST_GROUPS_MUTER;
FastGroupsMuter.exposedActions = ["Mute all", "Enable all", "Toggle all"];
FastGroupsMuter["@matchColors"] = { type: "string" };
FastGroupsMuter["@matchTitle"] = { type: "string" };
FastGroupsMuter["@showNav"] = { type: "boolean" };
FastGroupsMuter["@sort"] = {
    type: "combo",
    values: ["position", "alphanumeric", "custom alphabet"],
};
FastGroupsMuter["@customSortAlphabet"] = { type: "string" };
FastGroupsMuter["@toggleRestriction"] = {
    type: "combo",
    values: ["default", "max one", "always one"],
};
app.registerExtension({
    name: "rgthree.FastGroupsMuter",
    registerCustomNodes() {
        FastGroupsMuter.setUp(FastGroupsMuter);
    },
    loadedGraphNode(node) {
        if (node.type == FastGroupsMuter.title) {
            node.tempSize = [...node.size];
        }
    },
});
