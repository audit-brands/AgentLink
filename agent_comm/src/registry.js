"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var axios = require("axios");
var AGENTS = [
    { id: "claude-agent", endpoint: "http://localhost:5000" },
    { id: "gemini-agent", endpoint: "http://localhost:5001" }
];
var REGISTERED_AGENTS = {};
function discoverAgent(agentInfo) {
    return __awaiter(this, void 0, void 0, function () {
        var agentId, endpoint, agentJsonUrl, response, agentCard, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    agentId = agentInfo.id, endpoint = agentInfo.endpoint;
                    agentJsonUrl = "".concat(endpoint, "/.well-known/agent.json");
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, axios.get(agentJsonUrl, { timeout: 2000 })];
                case 2:
                    response = _a.sent();
                    agentCard = response.data;
                    REGISTERED_AGENTS[agentId] = {
                        endpoint: endpoint,
                        capabilities: agentCard.capabilities || [],
                        status: "active"
                    };
                    console.log("[REGISTRY] Discovered and registered agent: ".concat(agentId, " with capabilities ").concat(REGISTERED_AGENTS[agentId].capabilities));
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    if (error_1.isAxiosError) {
                        if (agentId in REGISTERED_AGENTS) {
                            REGISTERED_AGENTS[agentId].status = "inactive";
                            console.log("[REGISTRY] Agent ".concat(agentId, " became inactive: ").concat(error_1.message));
                        }
                        else {
                            console.log("[REGISTRY] Agent ".concat(agentId, " is not reachable: ").concat(error_1.message));
                        }
                    }
                    else {
                        console.error("[REGISTRY] An unexpected error occurred for ".concat(agentId, ":"), error_1);
                    }
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var _i, AGENTS_1, agentInfo, agentId, info;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log("[REGISTRY] Starting agent discovery service (single pass)...");
                    _i = 0, AGENTS_1 = AGENTS;
                    _a.label = 1;
                case 1:
                    if (!(_i < AGENTS_1.length)) return [3 /*break*/, 4];
                    agentInfo = AGENTS_1[_i];
                    return [4 /*yield*/, discoverAgent(agentInfo)];
                case 2:
                    _a.sent();
                    _a.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4:
                    console.log("[REGISTRY] Current Registered Agents:");
                    for (agentId in REGISTERED_AGENTS) {
                        info = REGISTERED_AGENTS[agentId];
                        console.log("  - ".concat(agentId, ": Status=").concat(info.status, ", Capabilities=").concat(info.capabilities.join(', ')));
                    }
                    console.log("[REGISTRY] Single pass complete. Exiting.");
                    return [2 /*return*/];
            }
        });
    });
}
main();
