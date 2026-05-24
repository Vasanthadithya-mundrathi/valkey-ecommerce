import React from "react";
import Preloader from "../helper/Preloader";
import ColorInit from "../helper/ColorInit";
import HeaderTwo from "../components/HeaderTwo";
import Breadcrumb from "../components/Breadcrumb";
import FooterTwo from "../components/FooterTwo";
import BottomFooter from "../components/BottomFooter";
import AgentSearch from "../components/AgentSearch";
import ScrollToTop from "react-scroll-to-top";

const AgentSearchPage = () => {
  return (
    <>
      <ColorInit color={true} />
      <ScrollToTop smooth color="#FA6400" />
      <Preloader />
      <HeaderTwo category={true} />
      <Breadcrumb title={"AI Search"} />
      <AgentSearch />
      <FooterTwo />
      <BottomFooter />
    </>
  );
};

export default AgentSearchPage;
