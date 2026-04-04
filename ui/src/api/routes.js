import client from "./client";

export const getRoutes = async () => {
  try {
    const response = await client.get("/api/routes");

    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch routes: ${error.message}`);
  }
};

export const createRoute = async (routeData) => {
  try {
    const response = await client.post("/api/routes", routeData);
    return response.data;
  } catch (error) {
    throw new Error(`Failed to create route: ${error.message}`);
  }
};

export const updateRoute = async (routeId, routeData) => {
  try {
    const response = await client.put(`/api/routes/${routeId}`, routeData);
    return response.data;
  } catch (error) {
    throw new Error(`Failed to update route: ${error.message}`);
  }
};

export const deleteRoute = async (routeId) => {
  try {
    const response = await client.delete(`/api/routes/${routeId}`);
    return response.data;
  } catch (error) {
    throw new Error(`Failed to delete route: ${error.message}`);
  }
};
