/**
 * input: 
 * @data data array, each item formatted to {"x": a, "y":b, "label": c}, and the position(a,b) are scaled to screen position
 * @weights weight of each scoring function
 * @width width of the svg
 * @height height of the svg
 * @bgcolor background color of the svg
 * output: 
 * array contains color corresponding to each label
 */
class Palettailor {
    constructor(data, weights, width, height, bgcolor) {
        this.data = data;
        this.weights = weights;
        this.width = width;
        this.height = height;
        this.bg_color = bgcolor
        this.cd_weight = [];
        this.criterion_cd = -1;

        // process to get label to class mapping
        this.label_to_class = {}
        let count = 0
        for (let d of data) {
            if (this.label_to_class[d.label] === undefined) this.label_to_class[d.label] = count++;
        }
        this.classNumber = Object.keys(this.label_to_class).length;
    }

    calc() {
        this.cd_weight = this.calculateAlphaShape([[0, 0], [this.width, this.height]]);
        // console.log("palettailor", this.cd_weight);

        let colors_scope = { "hue_scope": [0, 360], "lumi_scope": [35, 95] };
        let best_color = this.simulatedAnnealing2FindBestPalette(this.classNumber, (new_palette) => this.evaluatePalette(new_palette), colors_scope);

        let palette = {}
        for (let key in this.label_to_class) {
            palette[key] = best_color.id[this.label_to_class[key]]
        }

        return palette;
    }

    inverseFunc(x) {
        x = x == 0 ? 1 : x;
        return 1 / x;
    }

    norm(v, vscope = [0, 255]) {
        let normV = Math.max(vscope[0], v);
        normV = Math.min(normV, vscope[1]);
        return normV;
    }

    getRandomIntInclusive(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min; //The maximum is inclusive and the minimum is inclusive
    }

    /**
     * alpha-Shape graph Implementation
     * using Philippe Rivière’s bl.ocks.org/1b7ddbcd71454d685d1259781968aefc 
     * voronoi.find(x,y) finds the nearest cell to the point (x,y).
     * extent is like: [[30, 30], [width - 30, height - 30]]
     */
    calculateAlphaShape(extent) {
        let voronoi = d3.voronoi().x(d => d.x).y(d => d.y).extent(extent);
        if (!voronoi) {
            alert("This library is based on D3.")
        }
        let diagram = voronoi(this.data);
        let cells = diagram.cells;
        let alpha = 25 * 25 * 2;
        let distanceDict = {};
        let label_to_class = this.label_to_class
        let inverseFunc = this.inverseFunc
        for (let cell of cells) {
            if (cell === undefined) continue;
            let label = label_to_class[cell.site.data.label];
            cell.halfedges.forEach(function (e) {
                let edge = diagram.edges[e];
                let ea = edge.left;
                if (ea === cell.site || !ea) {
                    ea = edge.right;
                }
                if (ea) {
                    let ea_label = label_to_class[ea.data.label];
                    if (label != ea_label) {
                        let dx = cell.site[0] - ea[0],
                            dy = cell.site[1] - ea[1],
                            dist = dx * dx + dy * dy;
                        if (alpha > dist) {
                            if (distanceDict[label] === undefined)
                                distanceDict[label] = {};
                            if (distanceDict[label][ea_label] === undefined)
                                distanceDict[label][ea_label] = [];
                            distanceDict[label][ea_label].push(inverseFunc(Math.sqrt(dist)));
                        }
                    }
                }
            });
        }

        var distanceOf2Clusters = new TupleDictionary();
        for (var i in distanceDict) {
            for (var j in distanceDict[i]) {
                i = +i, j = +j;
                var dist;
                if (distanceDict[j] === undefined || distanceDict[j][i] === undefined)
                    dist = 2 * d3.sum(distanceDict[i][j]);
                else
                    dist = d3.sum(distanceDict[i][j]) + d3.sum(distanceDict[j][i]);
                if (i < j)
                    distanceOf2Clusters.put([i, j], dist);
                else
                    distanceOf2Clusters.put([j, i], dist);
            }
        }

        return distanceOf2Clusters;
    }

    /**
     * score the given palette
     */
    evaluatePalette(palette) {
        let class_distance = this.cd_weight;
        // calcualte color distance of given palette
        let class_discriminability = 0,
            name_difference = 0,
            color_discrimination_constraint = 100000;
        let dis;
        for (let i = 0; i < palette.length; i++) {
            for (let j = i + 1; j < palette.length; j++) {
                dis = d3_ciede2000(d3.lab(palette[i]), d3.lab(palette[j]));
                if (class_distance.get([i, j]) != undefined)
                    class_discriminability += class_distance.get([i, j]) * dis;
                let nd = getNameDifference(palette[i], palette[j]);
                name_difference += nd;
                color_discrimination_constraint = (color_discrimination_constraint > dis) ? dis : color_discrimination_constraint;
            }
            dis = d3_ciede2000(d3.lab(palette[i]), d3.lab(d3.rgb(this.bg_color)));
            color_discrimination_constraint = (color_discrimination_constraint > dis) ? dis : color_discrimination_constraint;
        }
        if (this.criterion_cd < 0)
            this.criterion_cd = class_discriminability;
        class_discriminability /= this.criterion_cd;
        name_difference /= palette.length * (palette.length - 1) * 0.25;
        // console.log(class_discriminability, name_difference, color_discrimination_constraint);

        return (this.weights[0] * class_discriminability + this.weights[1] * name_difference + this.weights[2] * (color_discrimination_constraint * 0.1));
    }

    /**
     * using simulated annealing to find the best palette of given data
     * @param {*} palette_size 
     * @param {*} evaluateFunc 
     * @param {*} colors_scope: hue range, lightness range, saturation range
     * @param {*} flag 
     */
    simulatedAnnealing2FindBestPalette(palette_size, evaluateFunc, colors_scope = { "hue_scope": [0, 360], "lumi_scope": [25, 85] }, flag = true) {
        let iterate_times = 0;
        //default parameters
        let max_temper = 100000,
            dec = 0.99,
            max_iteration_times = 10000000,
            end_temper = 0.001;
        let cur_temper = max_temper;
        //generate a totally random palette
        let color_palette = this.getColorPaletteRandom(palette_size);
        this.criterion_cd = -1.0;
        //evaluate the default palette
        let o = {
            id: color_palette,
            score: evaluateFunc(color_palette)
        },
            preferredObj = o;

        while (cur_temper > end_temper) {
            for (let i = 0; i < 1; i++) {//disturb at each temperature
                iterate_times++;
                color_palette = o.id.slice();
                this.disturbColors(color_palette, colors_scope);
                let color_palette_2 = color_palette.slice();
                let o2 = {
                    id: color_palette_2,
                    score: evaluateFunc(color_palette_2)
                };

                let delta_score = o.score - o2.score;
                if (delta_score <= 0 || delta_score > 0 && Math.random() <= Math.exp((-delta_score) / cur_temper)) {
                    o = o2;
                    if (preferredObj.score - o.score < 0) {
                        preferredObj = o;
                    }
                }
                if (iterate_times > max_iteration_times) {
                    break;
                }
            }

            cur_temper *= dec;
        }

        return preferredObj;
    }

    getColorPaletteRandom(palette_size) {
        let palette = [];
        for (let i = 0; i < palette_size; i++) {
            let rgb = d3.rgb(this.getRandomIntInclusive(0, 255), this.getRandomIntInclusive(0, 255), this.getRandomIntInclusive(0, 255));
            palette.push(rgb);
        }
        return palette;
    }

    /**
     * only use color discrimination
     * @param {} palette 
     * @param {*} colors_scope 
     */
    disturbColors(palette, colors_scope) {
        if (Math.random() < 0.5) {
            this.randomDisturbColors(palette, colors_scope);
        } else {
            // randomly shuffle two colors of the palette 
            let idx_0 = this.getRandomIntInclusive(0, palette.length - 1),
                idx_1 = this.getRandomIntInclusive(0, palette.length - 1);
            while (idx_0 === idx_1) {
                idx_1 = this.getRandomIntInclusive(0, palette.length - 1);
            }
            let tmp = palette[idx_0];
            palette[idx_0] = palette[idx_1];
            palette[idx_1] = tmp;
        }
    }


    randomDisturbColors(palette, colors_scope) {
        let disturb_step = 50;
        // random disturb one color
        let idx = this.getRandomIntInclusive(0, palette.length - 1),
            rgb = d3.rgb(palette[idx]),
            color = d3.rgb(this.norm(rgb.r + this.getRandomIntInclusive(-disturb_step, disturb_step)), this.norm(rgb.g + this.getRandomIntInclusive(-disturb_step, disturb_step)), this.norm(rgb.b + this.getRandomIntInclusive(-disturb_step, disturb_step))),
            hcl = d3.hcl(color);
        color = d3.rgb(d3.hcl(this.norm(hcl.h, colors_scope.hue_scope), this.norm(hcl.c, [0, 100]), this.norm(hcl.l, colors_scope.lumi_scope)));
        palette[idx] = d3.rgb(this.norm(color.r), this.norm(color.g), this.norm(color.b));
        let count = 0, sign;
        while (true) {
            while ((sign = this.isDiscriminative(palette)) > 0) {
                count += 1;
                if (count === 100) break;
                rgb = d3.rgb(palette[sign])
                color = d3.rgb(this.norm(rgb.r + this.getRandomIntInclusive(-disturb_step, disturb_step)), this.norm(rgb.g + this.getRandomIntInclusive(-disturb_step, disturb_step)), this.norm(rgb.b + this.getRandomIntInclusive(-disturb_step, disturb_step)))
                hcl = d3.hcl(color);
                if (hcl.h >= 85 && hcl.h <= 114 && hcl.l >= 35 && hcl.l <= 75) {
                    if (Math.abs(hcl.h - 85) > Math.abs(hcl.h - 114)) {
                        hcl.h = 115;
                    } else {
                        hcl.h = 84;
                    }
                }
                palette[sign] = d3.rgb(d3.hcl(this.norm(hcl.h, colors_scope.hue_scope), this.norm(hcl.c, [0, 100]), this.norm(hcl.l, colors_scope.lumi_scope)));
            }
            if (count >= 100 || sign === -1) break;
        }
    }

    isDiscriminative(palette) {
        let idx = -1;
        for (let i = 0; i < palette.length; i++) {
            for (let j = i + 1; j < palette.length; j++) {
                let color_dis = d3_ciede2000(d3.lab(palette[i]), d3.lab(palette[j]));
                if (color_dis < 10) {
                    return j;
                }
            }
        }
        return idx;
    }

}

class TupleDictionary {
    constructor() {
        this.dict = new Map();
    }

    tupleToString(tuple) {
        return tuple.join(",");
    }

    put(tuple, val) {
        this.dict.set(this.tupleToString(tuple), val);
    }

    get(tuple) {
        return this.dict.get(this.tupleToString(tuple));
    }

    keys() {
        return this.dict.keys();
    }

    length() {
        return this.dict.size;
    }
}

/**
* calculating the Color Saliency 
* reference to "Color Naming Models for Color Selection, Image Editing and Palette Design"
*/
function c3_init(json) {
    var i, C, W, T, A, ccount, tcount;

    // parse colors
    c3.color = [];
    for (i = 0; i < json.color.length; i += 3) {
        c3.color[i / 3] = d3.lab(json.color[i], json.color[i + 1], json.color[i + 2]);
    }
    C = c3.color.length;

    // parse terms
    c3.terms = json.terms;
    W = c3.terms.length;

    // parse count table
    c3.T = T = [];
    for (var i = 0; i < json.T.length; i += 2) {
        T[json.T[i]] = json.T[i + 1];
    }

    // construct counts
    c3.color.count = ccount = []; for (i = 0; i < C; ++i) ccount[i] = 0;
    c3.terms.count = tcount = []; for (i = 0; i < W; ++i) tcount[i] = 0;
    d3.keys(T).forEach(function (idx) {
        var c = Math.floor(idx / W),
            w = Math.floor(idx % W),
            v = T[idx] || 0;
        ccount[c] += v;
        tcount[w] += v;
    });

    // parse word association matrix
    c3.A = A = json.A;
}

function c3_api() {
    var C = c3.color.length,
        W = c3.terms.length,
        T = c3.T,
        A = c3.A,
        ccount = c3.color.count,
        tcount = c3.terms.count;

    c3.color.cosine = function (a, b) {
        var sa = 0, sb = 0, sc = 0, ta, tb;
        for (var w = 0; w < W; ++w) {
            ta = (T[a * W + w] || 0);
            tb = (T[b * W + w] || 0);
            sa += ta * ta;
            sb += tb * tb;
            sc += ta * tb;
        }
        return sc / (Math.sqrt(sa * sb));
    }

}
c3 = { version: "1.0.0" };
c3.load = function (uri, async) {
    async = async || false;
    var req = new XMLHttpRequest();
    var onload = function () {
        if (!async || req.readyState == 4) {
            if (req.status == 200 || req.status == 0) {
                c3_init(JSON.parse(req.responseText));
                c3_api();
            } else {
                alert("Error Loading C3 Data");
            }
        }
    };
    req.open('GET', uri, false);
    if (async) req.onreadystatechange = onload;
    req.send(null);
    if (!async) onload();
}
c3.load("./c3_data.json");
// color name lookup table
let color_name_map = {};
for (var c = 0; c < c3.color.length; ++c) {
    var x = c3.color[c];
    color_name_map[[x.L, x.a, x.b].join(",")] = c;
}

function getColorNameIndex(c) {
    var x = d3.lab(c),
        L = 5 * Math.round(x.L / 5),
        a = 5 * Math.round(x.a / 5),
        b = 5 * Math.round(x.b / 5),
        s = [L, a, b].join(",");
    return color_name_map[s];
}
function getNameDifference(x1, x2) {
    let c1 = getColorNameIndex(x1),
        c2 = getColorNameIndex(x2);
    return 1 - c3.color.cosine(c1, c2);
}