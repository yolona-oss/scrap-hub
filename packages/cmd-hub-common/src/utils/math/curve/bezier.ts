import { Point2D } from "../point";
import { EasingFunction } from "./helpers/easing";

export namespace Bezier{
    export function linear(t: number, p0: Point2D, p1: Point2D): Point2D {
        return {
            x: p0.x + t * (p1.x - p0.x),
            y: p0.y + t * (p1.y - p0.y),
        };
    }

    /**
     * Calculate a point on a cubic Bezier curve.
     * @param t - Normalized time (0 to 1).
     * @param p0 - Start point.
     * @param p1 - Control point 1.
     * @param p2 - Control point 2.
     * @param p3 - End point.
     * @returns The point on the curve at time `t`.
    */
    export function cubic(t: number, p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D): Point2D {
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;
        const uuu = uu * u;
        const ttt = tt * t;

        const x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
        const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;

        return { x, y };
    }

    /**
     * Quadratic Bézier curve implementation
     * @param t - Normalized time (0 to 1).
     * @param p0 - Start point
     * @param p1 - Control point
     * @param p2 - End point
     * @returns Point on the curve at time `t`
    */
    export function quadratic(t: number, p0: Point2D, p1: Point2D, p2: Point2D): Point2D {
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;

        const x = uu * p0.x + 2 * u * t * p1.x + tt * p2.y;
        const y = uu * p0.y + 2 * u * t * p1.y + tt * p2.y;

        return {x, y};
    }
    /**
     * Create a composite Bezier curve.
     * @param segments - An array of Bezier curve segments, where each segment is defined by 4 points: [P0, P1, P2, P3].
     * @param easingFunction - The easing function to control progression along the curve.
     * @param numPoints - The total number of points to generate for the entire composite curve.
     * @returns An array of points representing the composite Bezier curve.
    */
    export function composite(
        segments: Point2D[][], // Array of segments, each with 4 points: [P0, P1, P2, P3]
        numPoints: number,
        easingFunction: EasingFunction = (t) => t
    ): Point2D[] {
        const curve: Point2D[] = [];
        const numSegments = segments.length;

        for (let n = 0; n <= numPoints; n++) {
            const t = n / numPoints;
            const easedT = easingFunction(t);

            const segmentIndex = Math.min(Math.floor(easedT * numSegments), numSegments - 1);
            const segmentT = (easedT * numSegments) - segmentIndex;

            const [p0, p1, p2, p3] = segments[segmentIndex];

            const pointOnCurve = cubic(segmentT, p0, p1, p2, p3);

            curve.push(pointOnCurve);
        }

        return curve;
    }

    export function any(t: number, points: Point2D[]): Point2D {
        switch (points.length) {
            case 3: return quadratic(t, points[0], points[1], points[2]);
            case 4: return cubic(t, points[0], points[1], points[2], points[3]);
        }

        const n = points.length - 1;

        function factorial(n: number): number {
            if (n === 0 || n === 1) return 1;
            return n * factorial(n - 1);
        }

        function binomialCoefficient(n: number, k: number): number {
            return factorial(n) / (factorial(k) * factorial(n - k));
        }

        function bernsteinPolynomial(n: number, i: number, t: number): number {
            return binomialCoefficient(n, i) * Math.pow(t, i) * Math.pow(1 - t, n - i);
        }

        let x = 0;
        let y = 0;

        for (let i = 0; i <= n; i++) {
            const b = bernsteinPolynomial(n, i, t);
            x += b * points[i].x;
            y += b * points[i].y;
        }

        return { x, y };
    }

    export function compositeAny(points: Point2D[], numPoint: number) {
        const curve: Point2D[] = [];

        for (let n = 0; n <= numPoint; n++) {
            const t = n / numPoint;
            const pointOnCurve = any(t, points);
            curve.push(pointOnCurve);
        }

        return curve
    }
}
