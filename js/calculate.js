var Calculate = (function() {

  // shorthands for Three.js constructors

  var Vector3 = THREE.Vector3;
  var Line3 = THREE.Line3;
  var Box3 = THREE.Box3;
  var Plane = THREE.Plane;



  // internal functions - computations are performed on 3 vertices instead of
  // Face3 objects

  function _triangleArea(va, vb, vc) {
    var vab = va.clone().sub(vb);
    var vac = va.clone().sub(vc);

    // |(b - a) cross (c - a)| / 2
    return vab.cross(vac).length() / 2.0;
  }

  function _triangleVolume(va, vb, vc) {
    var volume = 0;
    volume += (-vc.x*vb.y*va.z + vb.x*vc.y*va.z + vc.x*va.y*vb.z);
    volume += (-va.x*vc.y*vb.z - vb.x*va.y*vc.z + va.x*vb.y*vc.z);

    return volume / 6.0;
  }

  function _triangleCenter(va, vb, vc) {
    var v = new Vector3();

    return v.add(va).add(vb).add(vc).divideScalar(3);
  }

  function _triangleCenterOfMass(va, vb, vc) {
    var v = new Vector3();

    return v.add(va).add(vb).add(vc).divideScalar(4);
  }

  function _triangleBoundingBox(va, vb, vc) {
    var box = new Box3();

    box.expandByPoint(va);
    box.expandByPoint(vb);
    box.expandByPoint(vc);

    return box;
  }

  function _planeTriangleIntersection(plane, va, vb, vc, normal) {
    // intersection points of the plane with all three face segments; each is
    // undefined if no intersection
    var iab = new Vector3();
    var ibc = new Vector3();
    var ica = new Vector3();

    iab = plane.intersectLine(new Line3(va, vb), iab);
    ibc = plane.intersectLine(new Line3(vb, vc), ibc);
    ica = plane.intersectLine(new Line3(vc, va), ica);

    var result = null;

    // if no intersections, return null
    if (iab === undefined && ibc === undefined && ica === undefined) {
      return null;
    }
    // in the anomalous situation that the plane intersects all three segments,
    // do special handling
    else if (iab !== undefined && ibc !== undefined && ica !== undefined) {
      // two possible degenerate cases:
      // 1. all three points lie on the plane, so there's no segment intersection
      // 2. two points lie on the plane - they form the segment
      var da = plane.distanceToPoint(va);
      var db = plane.distanceToPoint(vb);
      var dc = plane.distanceToPoint(vc);

      // if 1, return null
      if (da === 0 && db === 0 && dc === 0) return null;

      // if 2, two of the intersection points will be coincident; return two
      // non-coincident points (but only if one of them is above the plane)
      if (iab.equals(ibc) && (da > 0 || dc > 0)) result = new Line3(iab, ica);
      else if (ibc.equals(ica) && (db > 0 || da > 0)) result = new Line3(ibc, iab);
      else if (ica.equals(iab) && (dc > 0 || db > 0)) result = new Line3(ica, ibc);
      else return null;
    }
    // else two intersections, so get them and set the result
    else {
      // get the first and second intersections
      var v0 = iab !== undefined ? iab : ibc !== undefined ? ibc : ica;
      var v1 = v0 === iab ? (ibc !== undefined ? ibc : ica) : (v0 === ibc ? ica : undefined);

      // if either intersection doesn't exist, return null
      if (v0 === undefined || v1 === undefined) return null;
      // if intersection points are the same, return null
      if (v0.equals(v1)) return null;

      result = new Line3(v0, v1);
    }

    if (result === null) return null;

    // correct the order of points based on the normal
    var delta = new Vector3();
    result.delta(delta);

    if (normal.dot(delta.cross(plane.normal)) < 0) {
      var tmp = result.start;
      result.start = result.end;
      result.end = tmp;
    }

    return result;
  }



  // external functions

  // get an array of the face's vertices in the original winding order
  function _faceVertices(face, vertices, matrix, va, vb, vc) {
    va = va || new Vector3();
    vb = vb || new Vector3();
    vc = vc || new Vector3();

    va.copy(vertices[face.a]).applyMatrix4(matrix);
    vb.copy(vertices[face.b]).applyMatrix4(matrix);
    vc.copy(vertices[face.c]).applyMatrix4(matrix);

    return [va, vb, vc];
  }

  // calculate face area
  function _faceArea(face, vertices, matrix) {
    var [va, vb, vc] = _faceVertices(face, vertices, matrix);

    return _triangleArea(va, vb, vc);
  }

  // calculate the volume of an irregular tetrahedron with one vertex at the
  // origin and the given face forming the remaining three vertices
  function _faceVolume(face, vertices, matrix) {
    var [va, vb, vc] = _faceVertices(face, vertices, matrix);

    return _triangleVolume(va, vb, vc);
  }

  // center of a face
  function _faceCenter(face, vertices, matrix) {
    var [va, vb, vc] = _faceVertices(face, vertices, matrix);

    return _triangleCenter(va, vb, vc);
  }

  // center of mass of an irregular tetrahedron with one vertex at the origin
  // and the given face forming the remaining three vertices
  function _faceCenterOfMass(face, vertices, matrix) {
    var [va, vb, vc] = _faceVertices(face, vertices, matrix);

    return _triangleCenterOfMass(va, vb, vc);
  }

  // calculate a bounding box for a face
  function _faceBoundingBox(face, vertices, matrix) {
    var [va, vb, vc] = _faceVertices(face, vertices, matrix);

    return _triangleBoundingBox(va, vb, vc);
  }

  // calculate the intersection of a face with an arbitrary plane
  function _planeFaceIntersection(plane, face, vertices, matrix) {
    var [va, vb, vc] = _faceVertices(face, vertices, matrix);

    var normal = face.normal.clone().transformDirection(matrix);

    return _planeTriangleIntersection(plane, va, vb, vc, normal);
  }

  // apply a function to each face
  // - the callback takes three vertices and a normal, all in world space; these
  //   vectors are local variables in this function and should be copied, never
  //   stored directly
  // - both THREE.Geometry and THREE.BufferGeometry are supported
  function _traverseFaces(mesh, callback) {
    var geo = mesh.geometry;
    var matrixWorld = mesh.matrixWorld;

    var va = new Vector3();
    var vb = new Vector3();
    var vc = new Vector3();
    var normal = new Vector3();

    if (geo.isBufferGeometry) {
      var index = geo.index;
      var position = geo.attributes.position;

      // indexed faces - each triple of indices represents a face
      if (index !== null) {
        for (var i = 0, l = index.count; i < l; i += 3) {
          var a = index.getX(i);
          var b = index.getX(i + 1);
          var c = index.getX(i + 2);

          va.fromBufferAttribute(position, a).applyMatrix4(matrixWorld);
          vb.fromBufferAttribute(position, b).applyMatrix4(matrixWorld);
          vc.fromBufferAttribute(position, c).applyMatrix4(matrixWorld);

          THREE.Triangle.getNormal(va, vb, vc, normal);

          callback(va, vb, vc, normal);
        }
      }
      // else, each three contiguous verts in position attribute constitute a
      // face
      else {
        for (var i = 0, l = position.count; i < l; i += 3) {
          va.fromBufferAttribute(position, i).applyMatrix4(matrixWorld);
          vb.fromBufferAttribute(position, i + 1).applyMatrix4(matrixWorld);
          vc.fromBufferAttribute(position, i + 2).applyMatrix4(matrixWorld);

          THREE.Triangle.getNormal(va, vb, vc, normal);

          callback(va, vb, vc, normal);
        }
      }
    }
    else {
      var faces = geo.faces, vertices = geo.vertices;

      for (var f = 0; f < faces.length; f++) {
        var face = faces[f];

        _faceVertices(face, vertices, matrixWorld, va, vb, vc);
        normal.copy(face.normal).transformDirection(matrixWorld);

        callback(va, vb, vc, normal);
      }
    }
  }

  // calculate the surface area of a mesh
  function _surfaceArea(mesh) {
    var area = 0;

    _traverseFaces(mesh, function(va, vb, vc) {
      area += _triangleArea(va, vb, vc);
    });

    return area;
  }

  // calculate the volume of a mesh
  function _volume(mesh) {
    var volume = 0;

    _traverseFaces(mesh, function(va, vb, vc) {
      volume += _triangleVolume(va, vb, vc);
    });

    return volume;
  }

  // calculate the center of mass of a mesh
  function _centerOfMass(mesh) {
    var center = new Vector3();
    var volume = 0;

    _traverseFaces(mesh, function(va, vb, vc) {
      var faceVolume = _triangleVolume(va, vb, vc);
      var faceCenterOfMass = _triangleCenterOfMass(va, vb, vc);

      // add current face's center of mass, weighted by its volume
      center.add(faceCenterOfMass.multiplyScalar(faceVolume));

      // update volume
      volume += faceVolume;
    });

    // divide by total volume to get center of mass
    return center.divideScalar(volume);
  }

  function _crossSection(plane, mesh, splitPolygons) {
    // don't split by default
    splitPolygons = splitPolygons || false;

    var point = new Vector3();
    plane.coplanarPoint(point);

    var pa = new Vector3();
    var pb = new Vector3();
    var delta = new Vector3();
    var cross = new Vector3();

    // store the segments forming the intersection
    var segments = [];

    _traverseFaces(mesh, function(va, vb, vc, normal) {
      var segment = _planeTriangleIntersection(plane, va, vb, vc, normal);

      // nonzero contribution if plane intersects face
      if (segment !== null) segments.push(segment);
    });

    // make an array of polygons - if not splitting, the only element will be
    // an aggregate of the all the segments of the cross-section
    var segmentSets = splitPolygons ? _polygonsFromSegments(segments) : [segments];

    // calculate a { segments, boundingBox, area, length } object for each poly
    var result = [];

    for (var ss = 0, lss = segmentSets.length; ss < lss; ss++) {
      var segmentSet = segmentSets[ss];

      var area = 0;
      var length = 0;
      var boundingBox = new Box3();

      for (var s = 0, ls = segmentSet.length; s < ls; s++) {
        var segment = segmentSet[s];

        boundingBox.expandByPoint(segment.start);
        boundingBox.expandByPoint(segment.end);

        // triangle between coplanar point and the two endpoints of the segment
        pa.subVectors(segment.start, point);
        pb.subVectors(segment.end, point);

        // compute area of the triangle; possibly change sign depending on the
        // normal
        segment.delta(delta);
        cross.crossVectors(delta, plane.normal);
        var sign = Math.sign(pa.dot(cross));
        var segmentArea = pa.cross(pb).length() / 2;

        // increment area
        area += segmentArea * sign;

        // increment length
        length += segment.distance();
      }

      // result for the current polygon
      result.push({
        segments: segmentSet,
        boundingBox: boundingBox,
        area: area,
        length: length
      });
    }

    return result;
  }

  // calculate circle normal, center, and radius from three coplanar points:
  // take two pairs of coplanar points, calculate bisector of both pairs;
  // the bisectors will intersect at the center
  function _circleFromThreePoints(p0, p1, p2) {
    var sa = p0.clone().sub(p1);
    var sb = p2.clone().sub(p1);

    // normal
    var normal = sa.clone().cross(sb).normalize();

    // if points are collinear, can't compute the circle, so unready the
    // result and return
    if (normal.length() === 0) return null;

    // bisector points
    var pa = p0.clone().add(p1).multiplyScalar(0.5);
    var pb = p2.clone().add(p1).multiplyScalar(0.5);

    // bisector directions
    var da = normal.clone().cross(sa).normalize();
    var db = normal.clone().cross(sb).normalize();

    // the bisectors won't generally intersect exactly, but we can
    // calculate a point of closest approach:
    // if line 0 and 1 are
    // v0 = p0 + t0d0, v1 = p1 + t1d1, then
    // t0 = ((d0 - d1 (d0 dot d1)) dot (p1 - p0)) / (1 - (d0 dot d1)^2)
    // t1 = ((d0 (d0 dot d1) - d1) dot (p1 - p0)) / (1 - (d0 dot d1)^2)

    var dadb = da.dot(db);
    var denominator = 1 - dadb * dadb;

    // just in case, to avoid division by 0
    if (denominator === 0) return null;

    // scalar parameter
    var ta = da.clone().addScaledVector(db, -dadb).dot(pb.clone().sub(pa)) / denominator;

    var center = pa.clone().addScaledVector(da, ta);
    var radius = center.distanceTo(p2);

    return {
      normal: normal,
      center: center,
      radius: radius
    };
  }

  // hash map utilities for extracting polygons from segment lists

  function _numHash(n, p) {
    return Math.round(n*p);
  }

  function _vectorHash(v, p) {
    return _numHash(v.x, p)+'_' + _numHash(v.y, p) + '_' + _numHash(v.z, p);
  }

  function _objectGetKey(object) {
    for (var key in object) return key;
    return null;
  }

  function _polygonsFromSegments(segments, p) {
    p = p !== undefined ? p : 1e5;

    // adjacency map
    var m = {};

    // build the map
    for (var s = 0, l = segments.length; s < l; s++) {
      var segment = segments[s];
      var startHash = _vectorHash(segment.start, p);
      var endHash = _vectorHash(segment.end, p);

      // if segment is sufficiently long that its start and end don't hash to
      // the same value, add it to the map
      if (startHash !== endHash) m[startHash] = segment;
    }

    for (var s = 0, l = segments.length; s < l; s++) {
      var segment = segments[s];
      var startHash = _vectorHash(segment.start, p);
      var endHash = _vectorHash(segment.end, p);
    }

    // extract the polygons
    var polygons = [];
    var polygon;

    var start;
    var current = null;

    while ((start = _objectGetKey(m)) !== null) {
      current = start;
      polygon = [];

      do {
        segment = m[current];

        if (segment === undefined) break;

        polygon.push(segment);
        delete m[current];

        current = _vectorHash(segment.end, p);
      } while (current !== start);

      if (current === start) polygons.push(polygon);
    }

    //console.log(polygons);

    return polygons;
  }

  return {
    faceVertices: _faceVertices,
    faceArea: _faceArea,
    faceCenter: _faceCenter,
    faceBoundingBox: _faceBoundingBox,
    surfaceArea: _surfaceArea,
    volume: _volume,
    centerOfMass: _centerOfMass,
    crossSection: _crossSection,
    circleFromThreePoints: _circleFromThreePoints
  };

})();
