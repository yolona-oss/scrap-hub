import { Point2D } from "../point";
import { EasingFunction } from "./helpers/easing";

export function createCurve(
    start: Point2D,
    end: Point2D,
    numPoints: number,
    easingFunction: EasingFunction = (t) => t
): Point2D[] {
    const curve: Point2D[] = [];
    const x0 = start.x;
    const y0 = start.y;
    const x1 = end.x;
    const y1 = end.y;

    for (let n = 0; n <= numPoints; n++) {
        const t = n / numPoints;
        const easedT = easingFunction(t);

        const Xn = x0 + n;
        const Yn = y0 + (y1 - y0) * easedT;

        curve.push({ x: Xn, y: Yn });
    }

    return curve;
}
