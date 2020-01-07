/*
  Copyright 2017 Esri

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.​
*/

define([
  "calcite",
  "dojo/_base/declare",
  "esri/core/Evented",
  "ApplicationBase/ApplicationBase",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/_base/Color",
  "dojo/colors",
  "dojo/on",
  "dojo/dom",
  "dojo/dom-class",
  "dojo/dom-construct",
  "esri/config",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/identity/IdentityManager",
  "esri/portal/Portal",
  "esri/Graphic",
  "esri/geometry/geometryEngine",
  "esri/layers/GraphicsLayer",
  "esri/layers/FeatureLayer",
  "esri/tasks/support/FeatureSet",
  "esri/tasks/Geoprocessor",
  "esri/widgets/Feature"
], function(calcite, declare, Evented, ApplicationBase, i18n, itemUtils, domHelper,
            Color, colors, on, dom, domClass, domConstruct,
            esriConfig, watchUtils, promiseUtils, IdentityManager,
            Portal, Graphic, geometryEngine, GraphicsLayer, FeatureLayer,
            FeatureSet, Geoprocessor, Feature){

  return declare([Evented], {

    /**
     *
     */
    constructor: function(){
      this.CSS = { loading: "configurable-application--loading" };
      this.base = null;
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function(base){
      if(!base){
        console.error("ApplicationBase is not defined");
        return;
      }
      domHelper.setPageLocale(base.locale);
      domHelper.setPageDirection(base.direction);

      this.base = base;
      const config = base.config;
      const results = base.results;
      const find = config.find;
      const marker = config.marker;

      const allMapItems = results.webMapItems.concat(results.webSceneItems);
      const validMapItems = allMapItems.map(function(response){
        return response.value;
      });

      const firstItem = validMapItems[0];
      if(!firstItem){
        console.error("Could not load an item to display");
        return;
      }
      config.title = (config.title || itemUtils.getItemTitle(firstItem));
      domHelper.setPageTitle(config.title);

      const viewProperties = itemUtils.getConfigViewProperties(config);
      viewProperties.container = "view-container";

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({ item: firstItem, appProxies: appProxies }).then((map) => {
        viewProperties.map = map;
        return itemUtils.createView(viewProperties).then((view) => {
          domClass.remove(document.body, this.CSS.loading);
          this.viewReady(config, firstItem, view);
        });
      });


    },

    /**
     *
     * @param config
     * @param item
     * @param view
     */
    viewReady: function(config, item, view){

      // USER SIGN IN //
      this.initializeUserSignIn(view).always(() => {

        // DISPLAY VIEWSHED PANEL //
        view.ui.add("viewshed-panel", "top-right");
        domClass.remove("viewshed-panel", "hide");

        // INITIALIZE VIEWSHED //
        this.initializeViewshed(view);

        watchUtils.whenDefinedOnce(view, "viewpoint", () => {
          watchUtils.whenNotOnce(view, "updating", () => {
            view.goTo({ target: view.viewpoint.targetGeometry, tilt: 55.0, heading: 45.0 }, { speedFactor: 0.1 });
          });
        });

      });

    },

    /**
     *
     * @returns {*}
     */
    initializeUserSignIn: function(view){

      const checkSignInStatus = () => {
        return IdentityManager.checkSignInStatus(this.base.portal.url).then(userSignIn);
      };
      IdentityManager.on("credential-create", checkSignInStatus);
      IdentityManager.on("credential-destroy", checkSignInStatus);

      // SIGN IN NODE //
      const signInNode = dom.byId("sign-in-node");
      const userNode = dom.byId("user-node");

      // UPDATE UI //
      const updateSignInUI = () => {
        if(this.base.portal.user){
          dom.byId("user-firstname-node").innerHTML = this.base.portal.user.fullName.split(" ")[0];
          dom.byId("user-fullname-node").innerHTML = this.base.portal.user.fullName;
          dom.byId("username-node").innerHTML = this.base.portal.user.username;
          dom.byId("user-thumb-node").src = this.base.portal.user.thumbnailUrl;
          domClass.add(signInNode, "hide");
          domClass.remove(userNode, "hide");
        } else {
          domClass.remove(signInNode, "hide");
          domClass.add(userNode, "hide");
        }
        return promiseUtils.resolve();
      };

      // SIGN IN //
      const userSignIn = () => {
        this.base.portal = new Portal({ url: this.base.config.portalUrl, authMode: "immediate" });
        return this.base.portal.load().then(() => {
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).otherwise(console.warn);
      };

      // SIGN OUT //
      const userSignOut = () => {
        IdentityManager.destroyCredentials();
        this.base.portal = new Portal({});
        this.base.portal.load().then(() => {
          this.base.portal.user = null;
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).otherwise(console.warn);

      };

      // USER SIGN IN //
      on(signInNode, "click", userSignIn);

      // SIGN OUT NODE //
      const signOutNode = dom.byId("sign-out-node");
      if(signOutNode){
        on(signOutNode, "click", userSignOut);
      }

      return checkSignInStatus();
    },

    /**
     *
     * @param view
     */
    initializeViewshed: function(view){

      // VIEWSHED INFO //
      const viewshed_info = new Feature({ container: "viewshed-info" });

      // VIEWSHED FIELDS //
      const viewshed_fields = [
        { name: "OBJECTID", type: "oid", alias: "OBJECTID", visible: false },
        { name: "Frequency", type: "integer", alias: "Frequency", visible: false },
        { name: "DEMResolution", type: "string", alias: "DEM Resolution", length: 50, visible: true },
        { name: "ProductName", type: "string", alias: "Product Name", length: 50, visible: true },
        { name: "Source", type: "string", alias: "Source", length: 50, visible: true },
        { name: "Source_URL", type: "string", alias: "Source URL", length: 84, visible: true },
        { name: "PerimeterKm", type: "double", alias: "Perimeter Kilometers", visible: true },
        { name: "AreaSqKm", type: "double", alias: "Area Square Kilometers", visible: true },
        { name: "Shape_Length", type: "double", alias: "Shape Length", visible: false },
        { name: "Shape_Area", type: "double", alias: "Shape Area", visible: false },
      ];

      // VIEWSHED LAYER //
      const viewshed_layer = new FeatureLayer({
        fields: viewshed_fields,
        objectIdField: "OBJECTID",
        geometryType: "polygon",
        spatialReference: { wkid: 102100 },
        source: [],
        elevationInfo: { mode: "on-the-ground" },
        popupTemplate: {
          title: "{ProductName} @ {DEMResolution}",
          content: [
            {
              type: "fields",
              fieldInfos: viewshed_fields.map(field => {
                return {
                  fieldName: field.name,
                  label: field.alias,
                  visible: field.visible,
                  format: (field.type === "double") ? { digitSeparator: true, places: 2 } : null
                };
              })
            }
          ]
        },
        renderer: {
          type: "simple",
          symbol: {
            type: "polygon-3d",
            symbolLayers: [
              {
                type: "fill",
                material: { color: Color.named.lime.concat(0.1) },
                outline: { color: Color.named.lime.concat(0.5), size: 3.5 }
              }
            ]
          }
        }
      });

      // DISTANCE LAYER //
      const distance_layer = new FeatureLayer({
        fields: [{ name: "OBJECTID", type: "oid", alias: "OBJECTID" }],
        objectIdField: "OBJECTID",
        geometryType: "polygon",
        spatialReference: { wkid: 102100 },
        source: [],
        elevationInfo: { mode: "on-the-ground" },
        renderer: {
          type: "simple",
          symbol: {
            type: "polygon-3d",
            symbolLayers: [
              {
                type: "fill",
                material: { color: Color.named.white.concat(0.1) },
                outline: { color: Color.named.dodgerblue.concat(0.5), size: 3.5 }
              }
            ]
          }
        }
      });

      // OBSERVER LOCATION //
      const observer_layer = new FeatureLayer({
        fields: [{ name: "OBJECTID", type: "oid", alias: "OBJECTID" }],
        objectIdField: "OBJECTID",
        geometryType: "point",
        hasZ: true,
        spatialReference: { wkid: 102100 },
        source: [],
        elevationInfo: { mode: "absolute-height" },
        renderer: {
          type: "simple",
          symbol: {
            type: "point-3d",
            symbolLayers: [
              {
                type: "object",
                width: 50,
                depth: 50,
                height: 250,
                resource: { primitive: "inverted-cone" },
                material: { color: "dodgerblue" }
              }
            ]
          }
        }
      });

      view.map.addMany([observer_layer, distance_layer, viewshed_layer]);

      // UPDATE OBSERVER GRAPHIC //
      const updateObserverGraphic = (location, offset) => {
        const addFeatures = [];
        if(location){
          const observerLocation = location.clone();
          observerLocation.z += offset || 0.0;
          addFeatures.push({
            geometry: observerLocation,
            attributes: { offset: offset || 0.0 }
          })
        }
        observer_layer.queryFeatures().then(observerFS => {
          if((addFeatures.length > 0) || (observerFS.features.length > 0)){
            observer_layer.applyEdits({ addFeatures: addFeatures, deleteFeatures: observerFS.features }).then(applyEditResponse => {
              const newOID = applyEditResponse.addFeatureResults[0].objectId;
            });
          }
        });
      };

      // UPDATE DISTANCE GRAPHIC //
      const updateDistanceGraphic = (distance_buffer) => {
        const addFeatures = (distance_buffer) ? [{ geometry: distance_buffer }] : [];
        distance_layer.queryFeatures().then(distanceFS => {
          if((addFeatures.length > 0) || (distanceFS.features.length > 0)){
            distance_layer.applyEdits({ addFeatures: addFeatures, deleteFeatures: distanceFS.features }).then(applyEditResponse => {
              const newOID = applyEditResponse.addFeatureResults[0].objectId;
            });
          }
        });
      };

      // UPDATE VIEWSHED RESULTS //
      const updateViewshedResults = (viewshed_feature) => {
        const addFeatures = (viewshed_feature) ? [viewshed_feature] : [];
        viewshed_layer.queryFeatures().then(viewshedFS => {
          if((addFeatures.length > 0) || (viewshedFS.features.length > 0)){
            viewshed_layer.applyEdits({ addFeatures: addFeatures, deleteFeatures: viewshedFS.features }).then(applyEditResponse => {
              if(viewshed_feature){
                // DISPLAY DEM RESOLUTION DETAILS //
                viewshed_feature.popupTemplate = viewshed_layer.popupTemplate;
                viewshed_info.graphic = viewshed_feature;
              } else {
                viewshed_info.graphic = null;
              }
            });
          }
        });
      };


      //
      // JOB STATUS UPDATE //
      //
      const jobInfoNode = dom.byId("job-info");
      const jobStatusUpdate = (jobInfo) => {
        switch(jobInfo.jobStatus){
          case "job-none":
            jobInfoNode.innerHTML = "Set observer location by clicking on the map...";
            break;
          case "job-new":
          case "job-submitted":
          case "job-waiting":
            jobInfoNode.innerHTML = `<span class="busy-icon">Calculating viewshed...</span>`;
            break;
          case "job-executing":
            jobInfoNode.innerHTML = `<span class="busy-icon">Status: ${jobInfo.jobStatus.replace(/job-/, "")}...</span>`;
            break;
          case "job-cancelling":
          case "job-cancelled":
          case "job-deleting":
          case "job-deleted":
          case "job-timed-out":
          case "job-failed":
            displayErrorMessages(jobInfo.messages);
            break;
          case "job-succeeded":
            jobInfoNode.innerHTML = `<span class="icon-ui-check-mark icon-ui-green">Viewshed calculated successfully</span>`;
            break;
          default:
            jobInfoNode.innerHTML = "";
        }
      };

      //
      // VIEWSHED COMPLETE //
      //
      const viewshedCompleted = (viewshed_service, jobInfo) => {
        view.container.style.cursor = "crosshair";

        jobStatusUpdate({ jobStatus: "job-succeeded" });

        // GET VIEWSHED RESULTS //
        viewshed_service.getResultData(jobInfo.jobId, "OutputViewshed").then(parameterValue => {
          // VIEWSHED FEATURE //
          const viewshedFeature = parameterValue.value.features[0];//.clone();
          // UPDATE VIEWSHED RESULTS //
          updateViewshedResults(viewshedFeature);
        }, error => {
          displayErrorMessages([{ type: error.name, description: error.message }]);
        });

      };

      //
      // ERROR MESSAGES //
      //
      const displayErrorMessages = (messages) => {
        const message_items = messages.map(message => {
          return `<li>${message.type}: ${message.description}</li>`;
        });
        dom.byId("job-info").innerHTML = `<div class="icon-ui-error2 icon-ui-red">Messages</div><ul>${message_items}</ul>`;
      };


      //
      // VIEWSHED SERVICE URL //
      //
      const viewshed_service_url = "https://elevation.arcgis.com/arcgis/rest/services/Tools/Elevation/GPServer/Viewshed";
      esriConfig.request.trustedServers.push("https://elevation.arcgis.com");

      // CALCULATE VIEWSHED //
      const calcViewshed = (location) => {

        //
        // DISPLAY VIEWSHED BUFFER //
        //
        const analysisLocation = location.clone();
        analysisLocation.hasZ = false;
        const viewshedDistanceMeters = dom.byId("viewshed-distance-input").valueAsNumber;
        let viewshedBuffer = geometryEngine.geodesicBuffer(analysisLocation, viewshedDistanceMeters, "meters");
        updateDistanceGraphic(viewshedBuffer);


        // INPUT LOCATIONS //
        //  - NOTE: MAKE SURE THERE ARE NO Z VALUES SET IN THE GEOMETRY //
        const input_points = new FeatureSet({
          features: [
            new Graphic({
              geometry: { type: "point", x: location.x, y: location.y, hasZ: false, spatialReference: location.spatialReference }
            })
          ]
        });

        //
        // https://developers.arcgis.com/rest/elevation/api-reference/viewshed.htm
        // https://developers.arcgis.com/javascript/latest/api-reference/esri-tasks-support-JobInfo.html#jobStatus
        //
        const viewshed_service = new Geoprocessor({
          url: viewshed_service_url,
          outSpatialReference: view.spatialReference
        });

        return viewshed_service.submitJob({
          InputPoints: input_points,
          MaximumDistance: dom.byId("viewshed-distance-input").valueAsNumber,
          MaximumDistanceUnits: "Meters",
          DEMResolution: "FINEST", // FINEST | 10m | 24m | 30m | 90m
          ObserverHeight: dom.byId("observer-offset-input").valueAsNumber,
          ObserverHeightUnits: "Meters",
          SurfaceOffset: 0.0,
          SurfaceOffsetUnits: "Meters",
          GeneralizeViewshedPolygons: true
        }).then(jobInfo => {

          const jobId = jobInfo.jobId;
          const jobOptions = { "interval": 2000, "statusCallback": jobStatusUpdate };

          viewshed_service.waitForJobCompletion(jobId, jobOptions).then(() => {
            viewshedCompleted(viewshed_service, jobInfo);
          });

        }, error => {
          displayErrorMessages([{ type: error.name, description: error.message }]);
        });

      };

      const view_click_handle = on.pausable(view, "click", (evt) => {
        evt.stopPropagation();
        view_click_handle.pause();
        domClass.remove(observer_btn, "btn-green selected");

        updateObserverGraphic(evt.mapPoint, dom.byId("observer-offset-input").valueAsNumber);

        jobStatusUpdate({ jobStatus: "job-new" });

        view.container.style.cursor = "wait";
        calcViewshed(evt.mapPoint).always(() => {
          view.container.style.cursor = "default";
        });

      });
      view_click_handle.pause();

      const observer_btn = dom.byId("observer-btn");
      on(observer_btn, "click", () => {

        updateObserverGraphic();
        updateDistanceGraphic();
        updateViewshedResults();

        domClass.toggle(observer_btn, "btn-green selected");
        if(domClass.contains(observer_btn, "selected")){
          jobStatusUpdate({ jobStatus: "job-none" });
          view.container.style.cursor = "crosshair";
          view_click_handle.resume();
        } else {
          jobStatusUpdate({ jobStatus: "job-clear" });
          view.container.style.cursor = "default";
          view_click_handle.pause();
        }
      });


    }

  });
});
